import { useFonts } from 'expo-font'
import type { ReadingFont } from '../shared/types'

/**
 * Font files are the website's own faces, converted from WOFF2 to TrueType for Android (see
 * scripts/generate_brand_assets.py). They ship inside the APK, so no network font fetch happens.
 */
const FONT_ASSETS = {
  'PatrickHand-Regular': require('../../assets/fonts/PatrickHand-Regular.ttf'),
  'Lexend-Regular': require('../../assets/fonts/Lexend-Regular.ttf'),
  'Lexend-Medium': require('../../assets/fonts/Lexend-Medium.ttf'),
  'Lexend-SemiBold': require('../../assets/fonts/Lexend-SemiBold.ttf'),
  'Lexend-Bold': require('../../assets/fonts/Lexend-Bold.ttf'),
  'Poppins-Regular': require('../../assets/fonts/Poppins-Regular.ttf'),
  'Poppins-Medium': require('../../assets/fonts/Poppins-Medium.ttf'),
  'Poppins-SemiBold': require('../../assets/fonts/Poppins-SemiBold.ttf'),
  'Poppins-Bold': require('../../assets/fonts/Poppins-Bold.ttf'),
  'Sora-Regular': require('../../assets/fonts/Sora-Regular.ttf'),
  'Sora-Medium': require('../../assets/fonts/Sora-Medium.ttf'),
  'Sora-SemiBold': require('../../assets/fonts/Sora-SemiBold.ttf'),
  'Sora-Bold': require('../../assets/fonts/Sora-Bold.ttf'),
  'OpenSans-Regular': require('../../assets/fonts/OpenSans-Regular.ttf'),
  'OpenSans-Medium': require('../../assets/fonts/OpenSans-Medium.ttf'),
  'OpenSans-SemiBold': require('../../assets/fonts/OpenSans-SemiBold.ttf'),
  'OpenSans-Bold': require('../../assets/fonts/OpenSans-Bold.ttf')
} as const

/** Identity typeface: headings, labels, numbers, and the brand. It is never a user option. */
export const IDENTITY_FONT = 'PatrickHand-Regular'

export interface ReadingFamily { regular: string; medium: string; semibold: string; bold: string }

/** Reading fonts, the same four choices as the website's Settings. */
export const READING_FAMILIES: Record<ReadingFont, ReadingFamily> = {
  default: { regular: 'Lexend-Regular', medium: 'Lexend-Medium', semibold: 'Lexend-SemiBold', bold: 'Lexend-Bold' },
  poppins: { regular: 'Poppins-Regular', medium: 'Poppins-Medium', semibold: 'Poppins-SemiBold', bold: 'Poppins-Bold' },
  sora: { regular: 'Sora-Regular', medium: 'Sora-Medium', semibold: 'Sora-SemiBold', bold: 'Sora-Bold' },
  'open-sans': { regular: 'OpenSans-Regular', medium: 'OpenSans-Medium', semibold: 'OpenSans-SemiBold', bold: 'OpenSans-Bold' }
}

/** Loads every bundled face once. The app shows its launch overlay until this resolves. */
export function useAppFonts(): { loaded: boolean; error: Error | null } {
  const [loaded, error] = useFonts(FONT_ASSETS)
  return { loaded, error: error ?? null }
}
