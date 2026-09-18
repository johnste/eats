import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' rather than 'autoUpdate': the running page keeps executing
      // the code it loaded with either way, so the useful thing is to tell the
      // user a new version exists and let them choose when to take it.
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Eats',
        short_name: 'Eats',
        description: 'Calorie and macro tracker',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#12161f',
        theme_color: '#12161f',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the shell only. The API is deliberately untouched: a cached
        // food log that silently disagrees with the database is worse than an
        // honest "you're offline", and writes need the network regardless.
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Recharts alone is over the 2MB default.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // In dev the SPA and API are separate origins; proxying keeps the session
    // cookie same-origin, matching how production serves both from one process.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
