import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/favicon-32.png', 'icons/icon-192.png', 'icons/icon-maskable-512.png'],
      manifest: {
        name: 'Stracker — JEE 2027 Study Notebook',
        short_name: 'Stracker',
        description: 'A private notebook for JEE 2027 study plans, revision, tests, and focus sessions.',
        theme_color: '#f7f4ec',
        background_color: '#f7f4ec',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: []
      },
      devOptions: { enabled: true }
    })
  ],
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: { sourcemap: false, chunkSizeWarningLimit: 1000 }
})
