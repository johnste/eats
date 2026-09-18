import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * Identify the build so the app can say which version it is running -- useful
 * when a phone has been holding a stale service worker and you need to know
 * whether a fix has actually reached it.
 *
 * Inside the Docker image there is no .git directory, so the commit arrives as
 * a build argument instead; git is only consulted for local builds.
 */
function commitSha(): string {
  const fromEnv = process.env.SOURCE_COMMIT ?? process.env.GIT_COMMIT;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // autoUpdate, not prompt. Under 'prompt' the new worker installs and
      // then waits for every client to close before activating -- which on a
      // phone essentially never happens, so refreshing kept serving the old
      // cache indefinitely. The new worker now claims control as soon as it is
      // ready, and the toast tells you to reload to pick up the new code.
      registerType: 'autoUpdate',
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
        // Take over from the previous worker immediately rather than waiting
        // for all tabs to close.
        skipWaiting: true,
        clientsClaim: true,
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
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __COMMIT_SHA__: JSON.stringify(commitSha()),
  },
  build: { outDir: 'dist', sourcemap: true },
});
