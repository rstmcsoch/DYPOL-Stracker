import type { ConfigContext, ExpoConfig } from 'expo/config'

/**
 * Stracker — Expo application configuration.
 *
 * Identity: display name "Stracker", Android application ID `com.stracker.dypollabs`.
 * Android 7.0 (API 24) is the minimum SDK. Android ABIs are the four that React Native 0.86
 * ships native binaries for, so a single universal APK installs on 32-bit and 64-bit ARM and
 * on x86 / x86_64 emulators and Chromebooks. Verify the built APK with `scripts/verify-apk.sh`.
 *
 * No secrets live here. Public Supabase and API endpoints come from EXPO_PUBLIC_* variables
 * (see `.env.example`), which EAS injects at build time.
 */

// A production APK without its Supabase settings would install and never sign in. EAS sets
// EAS_BUILD_PROFILE on every cloud build, so this check fails the build early and says why. Local
// `expo export` and `prebuild` runs are unaffected.
if (process.env.EAS_BUILD_PROFILE === 'production' && !(process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim())) {
  throw new Error('Production builds need EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY set as EAS environment variables. See docs/mobile/eas-build.md.')
}

const BRAND = {
  cream: '#f7f4ec',
  night: '#202522'
} as const

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Stracker',
  slug: 'stracker',
  scheme: 'stracker',
  version: '1.0.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  backgroundColor: BRAND.cream,
  ios: {
    // Kept so the shared codebase stays iOS-ready. No iOS binary is produced at this stage.
    bundleIdentifier: 'com.stracker.dypollabs',
    supportsTablet: true
  },
  android: {
    package: 'com.stracker.dypollabs',
    versionCode: 1,
    predictiveBackGestureEnabled: false,
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
      backgroundColor: BRAND.cream
    },
    // Only what the app uses. Photo picking uses the system picker, which needs no storage permission.
    // POST_NOTIFICATIONS lets the one daily reminder appear on Android 13 and later, and only after the
    // user allows notifications in Settings.
    permissions: ['android.permission.POST_NOTIFICATIONS'],
    // Resize the layout when the keyboard opens, so the assistant composer and forms stay visible.
    softwareKeyboardLayoutMode: 'resize',
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.CAMERA',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.READ_CONTACTS',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      // Draw-over-other-apps is a developer-menu permission. Stracker never needs it.
      'android.permission.SYSTEM_ALERT_WINDOW'
    ],
    // The local cache is rebuilt from the cloud, and the session is kept in the Keystore. Cloud backup of the
    // app's data is therefore switched off, so study records are not copied to a Google account backup.
    allowBackup: false
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: BRAND.cream,
        image: './assets/images/splash-icon.png',
        imageWidth: 220,
        resizeMode: 'contain',
        dark: {
          backgroundColor: BRAND.night,
          image: './assets/images/splash-icon-dark.png'
        }
      }
    ],
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 24,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          // Release minification stays at the Expo default: R8 is not enabled until a device build
          // has been run and verified, so a shrinking regression cannot ship unnoticed.
          buildArchs: ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64']
        }
      }
    ],
    'expo-secure-store',
    'expo-sqlite'
  ]
})
