import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Unknown paths keep a real HTTP 404 (vercel.json has no catch-all rewrite), but Vercel serves
 * dist/404.html as that 404's body. Making it a copy of the app shell lets the router render the
 * styled in-app "Page not found" view with a Home link instead of the raw platform page.
 */
function spaNotFoundPage(): Plugin {
  return {
    name: 'stracker-spa-404',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const shell = bundle['index.html']
      if (shell?.type === 'asset') this.emitFile({ type: 'asset', fileName: '404.html', source: shell.source })
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    spaNotFoundPage(),
    VitePWA({
      // New workers activate immediately. The client registration intentionally does not
      // reload an open session; online page navigations are handled by NetworkFirst below.
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-32.png', 'icons/icon-192.png', 'icons/icon-maskable-512.png'],
      manifest: {
        name: 'Stracker — Exam Study Notebook',
        short_name: 'Stracker',
        description: 'A private study notebook for exam plans, revision, tests and focus sessions — by DYPOL LABS.',
        theme_color: '#f7f4ec',
        background_color: '#f7f4ec',
        display: 'standalone',
        // The installed app is usable in either orientation: the layout adapts to the
        // available width and height instead of assuming portrait.
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Do not let Workbox's default cache-first navigation fallback mask a deployment.
        // SPA rewrites return index.html online; the precache is only the offline fallback.
        navigateFallback: null,
        directoryIndex: null,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['404.html'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'stracker-navigation',
              // No network timeout: when online, the navigation response from the active
              // Vercel deployment must win. The precached shell is used only on failure.
              precacheFallback: { fallbackURL: '/index.html' }
            }
          }
        ]
      }
    })
  ],
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: { sourcemap: false, chunkSizeWarningLimit: 1000 }
})
