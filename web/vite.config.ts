import { defineConfig } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';
import react from '@vitejs/plugin-react';
import reactOgImage from 'vite-plugin-react-og-image';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [
    react(),
    reactOgImage({
      host: 'https://keating.help',
      componentPath: './src/og-image',
      imageResponseOptions: {
        width: 1200,
        height: 630,
      },
    }),
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
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
    assetsDir: 'assets',
    sourcemap: true,
  },
  esbuild: {
    loader: 'tsx',
    include: /\.(tsx?|jsx?)$/,
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
      // Required for WebGPU and SharedArrayBuffer
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  base: '/',
});
