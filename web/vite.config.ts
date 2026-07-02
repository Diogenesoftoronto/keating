import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import nodepod from '@scelar/nodepod/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import * as https from 'https';
import * as http from 'http';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildValidatedProxyUrl } from './server/utils/proxy-target';
import { isAllowedDioOpenAiProxyRequest } from './src/dio-provider/server';

type AgentRuntimeMode = 'browser-only' | 'remote' | 'cloud';

/**
 * Copy `node_modules/manim-web/dist/` into the build's public dir as
 * `/manim-web/...` so the animate tool can author raw manim-web scenes
 * and render them in an iframe that imports the library at this stable
 * public path. Works in both dev (Vite serves /manim-web/) and prod
 * (Nitro bundles the public/ dir).
 *
 * If the manim-web source directory is missing or stale, fall back to
 * any sibling copy in web/dist/manim-web (left over from a prior build)
 * and warn loudly. Without this fallback, an empty `public/manim-web/`
 * silently ships to production and the animate tool fails at runtime
 * with `disallowed MIME type ("text/html")` because the SPA shell
 * fills in for the missing file.
 */
function manimWebPublicPlugin(): Plugin {
	const SOURCE = resolve(__dirname, '../node_modules/manim-web/dist');
	const FALLBACK_DIST = resolve(__dirname, 'dist/manim-web');
	let publicDir: string | null = null;
	const markerName = '.keating-manim-web-source-mtime';
	const copyRecursive = (src: string, dst: string): void => {
		if (!existsSync(src)) return;
		for (const entry of readdirSync(src)) {
			const sourcePath = join(src, entry);
			const targetPath = join(dst, entry);
			const stat = statSync(sourcePath);
			if (stat.isDirectory()) {
				mkdirSync(targetPath, { recursive: true });
				copyRecursive(sourcePath, targetPath);
			} else {
				mkdirSync(dirname(targetPath), { recursive: true });
				copyFileSync(sourcePath, targetPath);
			}
		}
	};
	const ensureCopied = (): boolean => {
		if (!publicDir) return false;
		const target = join(publicDir, 'manim-web');
		const source = existsSync(SOURCE)
			? SOURCE
			: existsSync(FALLBACK_DIST)
				? FALLBACK_DIST
				: null;
		if (!source) {
			// eslint-disable-next-line no-console
			console.error(
				`[manim-web] source not found at ${SOURCE} (and no fallback at ${FALLBACK_DIST}); ` +
					`/manim-web/** will be missing from the build and the animate tool will fail at runtime. ` +
					`Run \`bun add manim-web\` (or \`bun install\`) at the repo root.`,
			);
			return false;
		}
		const sourceMtime = statSync(source).mtimeMs.toString();
		const markerPath = join(target, markerName);
		const previousMtime = existsSync(markerPath)
			? readFileSync(markerPath, 'utf8').trim()
			: '';
		if (previousMtime === sourceMtime && existsSync(join(target, 'index.js'))) {
			return true;
		}
		try {
			rmSync(target, { recursive: true, force: true });
			mkdirSync(target, { recursive: true });
			copyRecursive(source, target);
			writeFileSync(markerPath, sourceMtime);
			// eslint-disable-next-line no-console
			console.log(`[manim-web] copied ${source} -> ${target}`);
			return true;
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error(`[manim-web] copy failed:`, e);
			return false;
		}
	};
	return {
		name: 'keating-manim-web-public',
		apply: () => true,
		configResolved(config) {
			publicDir = config.publicDir;
			if (publicDir) ensureCopied();
		},
		configureServer(server) {
			if (!server.config.publicDir) return;
			publicDir = server.config.publicDir;
			ensureCopied();
		},
	};
}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function agentRuntimeMode(): AgentRuntimeMode {
  const mode = env('KEATING_WEB_AGENT_MODE');
  return mode === 'remote' || mode === 'cloud' ? mode : 'browser-only';
}

function agentRuntimeTargetBase(mode: AgentRuntimeMode): string | null {
  if (mode === 'browser-only') return null;
  if (mode === 'remote') return env('KEATING_WEB_REMOTE_ENDPOINT');
  return env('KEATING_WEB_CLOUD_ENDPOINT') || 'https://keating.help';
}

function chatProxyPlugin(): Plugin {
  return {
    name: 'chat-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/agent-runtime/config') {
          const mode = agentRuntimeMode();
          const body = JSON.stringify({
            mode,
            label: mode === 'cloud' ? 'Keating Cloud agent' : mode === 'remote' ? 'Remote microVM agent' : 'Browser-only agent',
            executionEndpoint: mode === 'browser-only' ? null : '/api/agent-runtime/remote',
            cloudEndpoint: mode === 'cloud' ? (process.env.KEATING_WEB_CLOUD_ENDPOINT || 'https://keating.help') : null,
            remote: mode === 'remote'
              ? {
                  provider: process.env.KEATING_WEB_REMOTE_PROVIDER || 'microsandbox',
                  endpoint: process.env.KEATING_WEB_REMOTE_ENDPOINT || null,
                  region: process.env.KEATING_WEB_REMOTE_REGION || null,
                  snapshot: process.env.KEATING_WEB_REMOTE_SNAPSHOT || null,
                  cpu: process.env.KEATING_WEB_REMOTE_CPU || null,
                  memory: process.env.KEATING_WEB_REMOTE_MEMORY || null,
                  disk: process.env.KEATING_WEB_REMOTE_DISK || null,
                }
              : null,
            capabilities: {
              browserLocal: true,
              remoteSandbox: mode !== 'browser-only',
              secureIsolation: mode !== 'browser-only',
              nativeBinaries: mode !== 'browser-only',
              serverBrokeredSecrets: mode !== 'browser-only',
              durableCompute: mode !== 'browser-only',
            },
            fallback: {
              localFirst: true,
              remoteAvailable: mode !== 'browser-only',
              message: mode === 'browser-only'
                ? 'Run supported agent work in the browser. Surface a fallback error for secure isolation, native binaries, brokered secrets, durable compute, or public inbound networking.'
                : 'Run browser-compatible work locally first. Route remote-only work through the configured backend.',
            },
          });
          res.setHeader('content-type', 'application/json');
          res.end(body);
          return;
        }

        if (req.url?.startsWith('/api/agent-runtime/remote')) {
          const mode = agentRuntimeMode();
          const targetBase = agentRuntimeTargetBase(mode);
          if (!targetBase) {
            res.statusCode = mode === 'browser-only' ? 403 : 503;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              error: mode === 'browser-only'
                ? 'Remote agent runtime is disabled in browser-only mode.'
                : 'Remote agent runtime endpoint is not configured.',
            }));
            return;
          }

          const proxyPath = req.url.replace(/^\/api\/agent-runtime\/remote\/?/, '');
          const targetUrl = new URL(`${targetBase.replace(/\/$/, '')}/api/agent-runtime/${proxyPath}`);
          const forbiddenHeaders = ['origin', 'host', 'referer'];
          const outHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (value && !forbiddenHeaders.includes(key.toLowerCase())) {
              outHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
            }
          }
          outHeaders.host = targetUrl.host;
          outHeaders['x-keating-agent-runtime-mode'] = mode;

          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            const body = Buffer.concat(chunks);
            const isHttps = targetUrl.protocol === 'https:';
            const lib = isHttps ? https : http;
            const proxyReq = lib.request(
              {
                hostname: targetUrl.hostname,
                port: targetUrl.port || (isHttps ? 443 : 80),
                path: targetUrl.pathname + targetUrl.search,
                method: req.method,
                headers: outHeaders,
              },
              (proxyRes) => {
                const resHeaders = { ...proxyRes.headers } as Record<string, string>;
                delete resHeaders['transfer-encoding'];
                res.writeHead(proxyRes.statusCode!, resHeaders);
                proxyRes.pipe(res);
              },
            );
            proxyReq.on('error', (err) => {
              console.error('[agent-runtime-proxy] request error:', err.message);
              if (!res.headersSent) {
                res.statusCode = 502;
                res.end('Agent runtime proxy error: ' + err.message);
              }
            });
            proxyReq.write(body);
            proxyReq.end();
          });
          return;
        }

        if (req.url?.startsWith('/api/dio/openai')) {
          if (process.env.DIO_ENABLED === 'false') {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }

          const targetBase = env('BIFROST_BASE_URL');
          if (!targetBase) {
            res.statusCode = 503;
            res.end('Dio gateway endpoint is not configured.');
            return;
          }

          const proxyPath = req.url.replace(/^\/api\/dio\/openai\/?/, '');
          if (!isAllowedDioOpenAiProxyRequest(req.method, proxyPath)) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }

          let targetUrl: URL;
          try {
            targetUrl = new URL(buildValidatedProxyUrl(targetBase, proxyPath, {
              allowHttp: process.env.NODE_ENV !== 'production',
              allowLocal: process.env.NODE_ENV !== 'production',
            }));
          } catch (error) {
            res.statusCode = 503;
            res.end(error instanceof Error ? error.message : 'Dio gateway endpoint is not configured.');
            return;
          }
          const forbiddenHeaders = [
            'x-stainless-os', 'x-stainless-lang', 'x-stainless-package-version',
            'x-stainless-runtime', 'x-stainless-runtime-version',
            'x-stainless-arch', 'x-stainless-os-version',
            'origin', 'host', 'referer', 'x-target-url',
          ];

          const outHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (value && !forbiddenHeaders.includes(key.toLowerCase())) {
              outHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
            }
          }
          outHeaders['host'] = targetUrl.host;

          const hasAuth = 'authorization' in outHeaders;
          const hasApiKey = 'x-api-key' in outHeaders;
          console.log(`[dio-proxy] ${req.method} ${proxyPath} -> configured gateway (auth=${hasAuth}, xApiKey=${hasApiKey})`);

          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            const body = Buffer.concat(chunks);
            const isHttps = targetUrl.protocol === 'https:';
            const lib = isHttps ? https : http;
            const proxyReq = lib.request(
              {
                hostname: targetUrl.hostname,
                port: targetUrl.port || (isHttps ? 443 : 80),
                path: targetUrl.pathname + targetUrl.search,
                method: req.method,
                headers: outHeaders,
              },
              (proxyRes) => {
                const resHeaders = { ...proxyRes.headers } as Record<string, string>;
                delete resHeaders['transfer-encoding'];
                res.writeHead(proxyRes.statusCode!, resHeaders);
                proxyRes.pipe(res);
              },
            );
            proxyReq.on('error', (err) => {
              console.error('[dio-proxy] request error:', err.message);
              if (!res.headersSent) {
                res.statusCode = 502;
                res.end('Dio proxy error: ' + err.message);
              }
            });
            proxyReq.write(body);
            proxyReq.end();
          });
          return;
        }

        if (!req.url?.startsWith('/api/chat-proxy')) return next();

        const targetBaseUrl = req.headers['x-target-url'] as string;
        if (!targetBaseUrl) {
          res.statusCode = 400;
          res.end('Missing x-target-url header');
          return;
        }

        let targetUrl: URL;
        try {
          const proxyPath = req.url.replace(/^\/api\/chat-proxy\/?/, '');
          targetUrl = new URL(buildValidatedProxyUrl(targetBaseUrl, proxyPath, {
            allowHttp: true,
            allowLocal: true,
          }));
        } catch (error) {
          res.statusCode = 400;
          res.end(error instanceof Error ? error.message : 'Invalid x-target-url header');
          return;
        }

        const proxyPath = req.url.replace(/^\/api\/chat-proxy\/?/, '');

        const forbiddenHeaders = [
          'x-stainless-os', 'x-stainless-lang', 'x-stainless-package-version',
          'x-stainless-runtime', 'x-stainless-runtime-version',
          'x-stainless-arch', 'x-stainless-os-version',
          'origin', 'host', 'referer', 'x-target-url',
        ];

        const outHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (value && !forbiddenHeaders.includes(key.toLowerCase())) {
            outHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
          }
        }
        outHeaders['host'] = targetUrl.host;

        const hasAuth = 'authorization' in outHeaders;
        const hasApiKey = 'x-api-key' in outHeaders;
        console.log(`[chat-proxy] ${req.method} ${proxyPath} -> ${targetUrl.hostname} (auth=${hasAuth}, xApiKey=${hasApiKey})`);

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const isHttps = targetUrl.protocol === 'https:';
          const lib = isHttps ? https : http;
          const proxyReq = lib.request(
            {
              hostname: targetUrl.hostname,
              port: targetUrl.port || (isHttps ? 443 : 80),
              path: targetUrl.pathname + targetUrl.search,
              method: req.method,
              headers: outHeaders,
            },
            (proxyRes) => {
              const resHeaders = { ...proxyRes.headers } as Record<string, string>;
              delete resHeaders['transfer-encoding'];
              res.writeHead(proxyRes.statusCode!, resHeaders);
              proxyRes.pipe(res);
            },
          );
          proxyReq.on('error', (err) => {
            console.error('[chat-proxy] request error:', err.message);
            if (!res.headersSent) {
              res.statusCode = 502;
              res.end('Proxy error: ' + err.message);
            }
          });
          proxyReq.write(body);
          proxyReq.end();
        });
      });
    },
  };
}

import pkg from './package.json';

// Opt-in bundle analysis: `ANALYZE=1 vite build` emits dist/stats.html.
const analyzePlugins: Plugin[] = process.env.ANALYZE
  ? [
      visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }) as Plugin,
    ]
  : [];

export default defineConfig({
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(pkg.version),
  },
  root: '.',
  publicDir: 'public',
  plugins: [
    react(),
    tailwindcss(),
    nodepod(),
    chatProxyPlugin(),
    manimWebPublicPlugin(),
    ...analyzePlugins,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.svg'],
      manifest: {
        name: 'Keating - Hyperteacher',
        short_name: 'Keating',
        description: 'A Pi-powered hyperteacher for cognitive empowerment',
        theme_color: '#f4f1ea',
        background_color: '#f4f1ea',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        importScripts: ['sw-update-reload.js'],
        // Never substitute the precached SPA shell for share routes, API
        // routes, or hashed assets. A stale service worker serving the old
        // index.html for /s/:id caused "module script … MIME type text/html"
        // (the shell referenced an asset hash the new server no longer has).
        // Share/API routes must reach the server (also required for the
        // server-rendered OpenGraph meta on /s/:id).
        navigateFallbackDenylist: [/^\/s\//, /^\/api\//, /^\/assets\//],
        // vite-plugin-pwa FAILS the build if a precached file exceeds this
        // limit (it does not silently skip), so it must stay above the largest
        // emitted chunk. sandbox-export is currently ~4.3MB; we round up to
        // 6MB for headroom. The asset-cache runtime rule below catches anything
        // that still doesn't fit, so an offline reload still works for chunks
        // exceeding this cap.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, // 6MB
        runtimeCaching: [
          {
            // Content-hashed build assets: filename changes on every build, so
            // CacheFirst is safe and gives offline support for chunks that were
            // too large to precache.
            urlPattern: /\/assets\/.*\.(?:js|css|woff2?|ttf)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'asset-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          {
            // Web fonts (e.g. KaTeX fonts loaded at runtime from package paths).
            urlPattern: /\.(?:woff2?|ttf|otf|eot)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'font-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          {
            urlPattern: /\.(?:wasm|onnx)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasm-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          {
            urlPattern: /^https:\/\/huggingface\.co\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'model-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 5000,
    reportCompressedSize: false,
    ssr: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  server: {
    port: 3000,
    fs: {
      // Allow importing the shared, dependency-free fine-tune parser that
      // lives at the repo root (one level above this web package).
      allow: ['..'],
    },
    proxy: {
      '/ingest/static': {
        target: 'https://us-assets.i.posthog.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest/, ''),
      },
      '/ingest/array': {
        target: 'https://us-assets.i.posthog.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest/, ''),
      },
      '/ingest': {
        target: 'https://us.i.posthog.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest/, ''),
      },
    },
    watch: {
      ignored: [
        '**/.bun-install/**',
        '**/.bun-tmp/**',
        '**/dist/**',
        '**/.output/**',
      ],
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Access-Control-Allow-Origin': '*',
    },
  },
  base: '/',
});
