/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly DEV: boolean
  /** Local design builds only: force the Google button visible. Never set on Vercel. */
  readonly VITE_GOOGLE_AUTH_FORCE_VISIBLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
declare module 'katex/contrib/mhchem'
