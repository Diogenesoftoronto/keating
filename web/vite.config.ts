import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import * as https from 'https';
import * as http from 'http';

function chatProxyPlugin(): Plugin {
  return {
    name: 'chat-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/chat-proxy')) return next();

        const targetBaseUrl = req.headers['x-target-url'] as string;
        if (!targetBaseUrl) {
          res.statusCode = 400;
          res.end('Missing x-target-url header');
          return;
        }

        let parsedTarget: URL;
        try {
          parsedTarget = new URL(targetBaseUrl);
        } catch {
          res.statusCode = 400;
          res.end('Invalid x-target-url header');
          return;
        }

        const proxyPath = req.url.replace(/^\/api\/chat-proxy\/?/, '');
        const fullTarget = `${parsedTarget.href.replace(/\/$/, '')}/${proxyPath}`;
        const targetUrl = new URL(fullTarget);

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
            console.error('[chat-proxy]', err.message);
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

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [
    react(),
    tailwindcss(),
    chatProxyPlugin(),
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
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB for large bundles
        // Cache WebGPU WASM files
        runtimeCaching: [
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
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
      },
    },
  },
  base: '/',
});
