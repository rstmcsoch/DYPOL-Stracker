import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.dypollabs.stracker',
  appName: 'Stracker',
  webDir: 'dist',
  // The Android app opens the deployed Stracker website so the existing Supabase
  // authentication, notebook sync, and server-side AI endpoints remain the source of truth.
  server: {
    url: 'https://dypol-stracker.vercel.app',
    cleartext: false
  },
  android: {
    allowMixedContent: false
  }
}

export default config
