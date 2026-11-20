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

/**
 * Splits large, rarely changing third-party packages into dedicated cacheable chunks so browsers
 * fetch them in parallel over HTTP/2 and keep them cached across app deploys.
 */
function vendorChunkFor(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
  if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'vendor-supabase'
  if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return 'vendor-query'
  if (/[\\/]node_modules[\\/]dexie[\\/]/.test(id)) return 'vendor-dexie'
  if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/.test(id)) return 'vendor-charts'
  if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
  if (/[\\/]node_modules[\\/]date-fns[\\/]/.test(id)) return 'vendor-dates'
  if (/[\\/]node_modules[\\/]zod[\\/]/.test(id)) return 'vendor-zod'
  if (/[\\/]node_modules[\\/](jspdf|docx|jszip|html2canvas|canvg|fflate)[\\/]/.test(id)) return 'vendor-export'
  if (/[\\/]node_modules[\\/](react-markdown|remark-[^\\/]+|unified|mdast-[^\\/]+|micromark[^\\/]*|hast-[^\\/]+|unist-[^\\/]+)[\\/]/.test(id)) return 'vendor-markdown'
  return undefined
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
        name: 'Stracker — JEE 2027 Study Notebook',
        short_name: 'Stracker',
        description: 'A private study notebook for JEE 2027 plans, revision, tests and focus sessions — by DYPOL LABS.',
        theme_color: '#f7f4ec',
        background_color: '#f7f4ec',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
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
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: vendorChunkFor
      }
    }
  },
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true }
})
