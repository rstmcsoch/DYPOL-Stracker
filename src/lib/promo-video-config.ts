import type { SiteValues } from './site-content/content'

/**
 * Typed, clamped view of the `public.video.*` site-content fields.
 *
 * The registry validation already bounds every stored value; this module re-clamps at
 * render time so the player stays responsive and proportionate even if a stored row is
 * edited by hand or a future default drifts. Nothing here performs I/O.
 */

export const PROMO_LIMITS = {
  desktopVh: { min: 40, max: 70, fallback: 54 },
  mobileVh: { min: 50, max: 70, fallback: 66 },
  maxWidth: { min: 240, max: 1000, fallback: 960 },
  radius: { min: 0, max: 40, fallback: 28 },
  fadeStrength: { min: 20, max: 100, fallback: 100 },
  spacing: { min: 8, max: 96, fallback: 44 },
  controlScale: { min: 80, max: 130, fallback: 100 }
} as const

/** One-tap sizes: they simply write the two bounding numbers, so the stored
    configuration always has a single source of truth. */
export const VIDEO_SIZE_PRESETS = {
  compact: { desktopVh: 46, maxWidth: 640 },
  medium: { desktopVh: 54, maxWidth: 960 },
  large: { desktopVh: 64, maxWidth: 1000 }
} as const

export type VideoSizePreset = keyof typeof VIDEO_SIZE_PRESETS | 'custom'

export const ASPECT_PRESETS = {
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '4:5': 4 / 5,
  '1:1': 1
} as const

export type PromoAspect = 'auto' | keyof typeof ASPECT_PRESETS
export type PromoShadow = 'none' | 'soft' | 'deep'
export type PromoTheme = 'auto' | 'light' | 'dark'
export type PromoPosterFit = 'cover' | 'contain'

export interface PromoVideoConfig {
  enabled: boolean
  src: string
  poster: string
  autoplay: boolean
  muted: boolean
  loop: boolean
  aspect: PromoAspect
  desktopVh: number
  tabletVh: number
  mobileVh: number
  maxWidth: number
  radius: number
  fade: boolean
  fadeStrength: number
  shadow: PromoShadow
  spacing: number
  spacingMobile: number
  controlScale: number
  posterFit: PromoPosterFit
  theme: PromoTheme
  /** Which one-tap size the current numbers match, or `custom`. */
  size: VideoSizePreset
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function flag(values: SiteValues, key: string, fallback: boolean): boolean {
  return (values[key] ?? (fallback ? 'true' : 'false')) === 'true'
}

function num(values: SiteValues, key: string, bounds: { min: number; max: number; fallback: number }): number {
  const parsed = Number.parseInt(values[key] ?? '', 10)
  return clamp(parsed, bounds.min, bounds.max, bounds.fallback)
}

function choice<T extends string>(values: SiteValues, key: string, allowed: readonly T[], fallback: T): T {
  const value = values[key]
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback
}

/** Resolves the published (or draft) site values into a safe player configuration. */
export function resolvePromoVideoConfig(values: SiteValues): PromoVideoConfig {
  const desktopVh = num(values, 'public.video.desktop_height', PROMO_LIMITS.desktopVh)
  const mobileVh = num(values, 'public.video.mobile_height', PROMO_LIMITS.mobileVh)
  const maxWidth = num(values, 'public.video.max_width', PROMO_LIMITS.maxWidth)
  const spacing = num(values, 'public.video.spacing', PROMO_LIMITS.spacing)
  const preset = (Object.keys(VIDEO_SIZE_PRESETS) as Array<keyof typeof VIDEO_SIZE_PRESETS>)
    .find(name => VIDEO_SIZE_PRESETS[name].desktopVh === desktopVh && VIDEO_SIZE_PRESETS[name].maxWidth === maxWidth)

  return {
    enabled: flag(values, 'public.video.enabled', true),
    src: values['public.video.src'] ?? '',
    poster: values['public.video.poster'] ?? '',
    autoplay: flag(values, 'public.video.autoplay', true),
    muted: flag(values, 'public.video.muted', true),
    loop: flag(values, 'public.video.loop', true),
    aspect: choice(values, 'public.video.aspect', ['auto', '9:16', '16:9', '4:5', '1:1'] as const, 'auto'),
    desktopVh,
    // Tablets sit between the phone and desktop budgets; derived, never stored.
    tabletVh: clamp((desktopVh + mobileVh) / 2, 45, 70, 62),
    mobileVh,
    maxWidth,
    radius: num(values, 'public.video.radius', PROMO_LIMITS.radius),
    fade: flag(values, 'public.video.fade', true),
    fadeStrength: num(values, 'public.video.fade_strength', PROMO_LIMITS.fadeStrength),
    shadow: choice(values, 'public.video.shadow', ['none', 'soft', 'deep'] as const, 'soft'),
    spacing,
    // Phones scale the spacing down but never below 24px (unless the owner
    // chose a tighter desktop spacing) and never above the desktop value.
    spacingMobile: Math.min(spacing, Math.max(Math.min(24, spacing), Math.round(spacing * 0.72))),
    controlScale: num(values, 'public.video.control_scale', PROMO_LIMITS.controlScale),
    posterFit: choice(values, 'public.video.poster_fit', ['cover', 'contain'] as const, 'cover'),
    theme: choice(values, 'public.video.theme', ['auto', 'light', 'dark'] as const, 'auto'),
    size: preset ?? 'custom'
  }
}

/** Central/speaker button pixel sizes for a control scale, keeping every target ≥ 44px. */
export function controlSizes(scale: number): { play: number; playMobile: number; speaker: number; speakerMobile: number } {
  const ratio = clamp(scale, PROMO_LIMITS.controlScale.min, PROMO_LIMITS.controlScale.max, 100) / 100
  return {
    play: clamp(68 * ratio, 56, 88, 68),
    playMobile: clamp(60 * ratio, 52, 72, 60),
    speaker: clamp(48 * ratio, 44, 60, 48),
    speakerMobile: clamp(46 * ratio, 44, 56, 46)
  }
}
