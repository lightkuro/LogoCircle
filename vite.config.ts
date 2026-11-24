import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable, and works offline after the first visit.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'LogoCircle',
        short_name: 'LogoCircle',
        description: 'Draw simple outlines, tap to color, export a clean SVG logo.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ececef',
        theme_color: '#ececef',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Fonts are fetched when first used, then kept for offline use.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // The privacy and terms page is a page of its own, not a route of the app.
        navigateFallbackDenylist: [/^\/privacy/],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.woff$/,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 80 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { target: 'es2022', sourcemap: false },
  server: { host: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
  },
});
