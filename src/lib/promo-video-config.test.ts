import { describe, expect, it } from 'vitest'
import { resolveSiteValues } from './site-content/content'
import { fieldDefinition } from './site-content/registry'
import { validateFieldValue } from './site-content/content'
import { controlSizes, resolvePromoVideoConfig, VIDEO_SIZE_PRESETS } from './promo-video-config'

describe('promo video configuration resolution', () => {
  it('reproduces the shipped player with no saved configuration', () => {
    const config = resolvePromoVideoConfig(resolveSiteValues(undefined))
    expect(config.enabled).toBe(true)
    expect(config.src).toBe('')
    expect(config.poster).toBe('')
    expect(config.autoplay).toBe(true)
    expect(config.muted).toBe(true)
    expect(config.loop).toBe(true)
    expect(config.desktopVh).toBe(54)
    expect(config.mobileVh).toBe(66)
    expect(config.maxWidth).toBe(960)
    expect(config.radius).toBe(28)
    expect(config.fade).toBe(true)
    expect(config.fadeStrength).toBe(100)
    expect(config.shadow).toBe('soft')
    expect(config.controlScale).toBe(100)
    expect(config.theme).toBe('auto')
    expect(config.size).toBe('medium')
  })

  it('clamps every numeric value into its safe range, even bypassing validation', () => {
    const handEdited = {
      ...resolveSiteValues(undefined),
      'public.video.desktop_height': '400',
      'public.video.mobile_height': '3',
      'public.video.max_width': '12',
      'public.video.radius': '999',
      'public.video.spacing': '2',
      'public.video.control_scale': '900',
      'public.video.fade_strength': '5'
    }
    const config = resolvePromoVideoConfig(handEdited)
    expect(config.desktopVh).toBe(70)
    expect(config.mobileVh).toBe(50)
    expect(config.maxWidth).toBe(240)
    expect(config.radius).toBe(40)
    expect(config.spacing).toBe(8)
    expect(config.controlScale).toBe(130)
    expect(config.fadeStrength).toBe(20)
    // Mobile spacing scales down but never collapses nor exceeds the desktop value.
    expect(config.spacingMobile).toBeGreaterThanOrEqual(Math.min(24, config.spacing))
    expect(config.spacingMobile).toBeLessThanOrEqual(config.spacing)
  })

  it('drops out-of-range stored values to the defaults on the lenient read', () => {
    const config = resolvePromoVideoConfig(resolveSiteValues({
      'public.video.desktop_height': '400',
      'public.video.radius': '999'
    }))
    expect(config.desktopVh).toBe(54)
    expect(config.radius).toBe(28)
  })

  it('keeps invalid stored values from breaking the player', () => {
    const config = resolvePromoVideoConfig(resolveSiteValues({
      'public.video.enabled': 'yes',
      'public.video.aspect': '21:9',
      'public.video.shadow': 'glow',
      'public.video.desktop_height': 'not-a-number'
    }))
    expect(config.enabled).toBe(true)
    expect(config.aspect).toBe('auto')
    expect(config.shadow).toBe('soft')
    expect(config.desktopVh).toBe(54)
  })

  it('recognises the one-tap sizes and treats anything else as custom', () => {
    expect(resolvePromoVideoConfig(resolveSiteValues({
      'public.video.desktop_height': String(VIDEO_SIZE_PRESETS.compact.desktopVh),
      'public.video.max_width': String(VIDEO_SIZE_PRESETS.compact.maxWidth)
    })).size).toBe('compact')
    expect(resolvePromoVideoConfig(resolveSiteValues({
      'public.video.desktop_height': '55'
    })).size).toBe('custom')
  })

  it('never lets control scaling drop a touch target below 44px', () => {
    const small = controlSizes(80)
    expect(small.play).toBeGreaterThanOrEqual(56)
    expect(small.playMobile).toBeGreaterThanOrEqual(52)
    expect(small.speaker).toBeGreaterThanOrEqual(44)
    expect(small.speakerMobile).toBeGreaterThanOrEqual(44)
    const large = controlSizes(130)
    expect(large.play).toBeLessThanOrEqual(88)
  })
})

describe('video field validation', () => {
  const definition = (key: string) => {
    const found = fieldDefinition(key)
    if (!found) throw new Error(`missing ${key}`)
    return found
  }

  it('accepts only true/false for toggles', () => {
    const toggle = definition('public.video.enabled')
    expect(validateFieldValue(toggle, 'true').ok).toBe(true)
    expect(validateFieldValue(toggle, 'false').ok).toBe(true)
    expect(validateFieldValue(toggle, 'yes').ok).toBe(false)
  })

  it('bounds numbers to their declared range', () => {
    const height = definition('public.video.desktop_height')
    expect(validateFieldValue(height, '54')).toEqual({ ok: true, value: '54' })
    expect(validateFieldValue(height, '054')).toEqual({ ok: true, value: '54' })
    expect(validateFieldValue(height, '39').ok).toBe(false)
    expect(validateFieldValue(height, '71').ok).toBe(false)
    expect(validateFieldValue(height, '54.5').ok).toBe(false)
  })

  it('accepts only listed select options', () => {
    const shadow = definition('public.video.shadow')
    expect(validateFieldValue(shadow, 'deep').ok).toBe(true)
    expect(validateFieldValue(shadow, 'gigantic').ok).toBe(false)
  })

  it('allows an empty media url (bundled default) but only the media library otherwise', () => {
    const src = definition('public.video.src')
    expect(validateFieldValue(src, '')).toEqual({ ok: true, value: '' })
    expect(validateFieldValue(src, '/videos/Stracker%20Ad1.mp4').ok).toBe(true)
    expect(validateFieldValue(src, 'https://abc.supabase.co/storage/v1/object/public/homepage-media/videos/1-x.mp4').ok).toBe(true)
    expect(validateFieldValue(src, 'https://abc.supabase.co/storage/v1/object/public/other-bucket/videos/1.mp4').ok).toBe(false)
    expect(validateFieldValue(src, 'https://abc.supabase.co/storage/v1/object/sign/homepage-media/videos/1.mp4?token=x').ok).toBe(false)
    expect(validateFieldValue(src, 'https://user:pass@example.com/storage/v1/object/public/homepage-media/videos/1.mp4').ok).toBe(false)
    expect(validateFieldValue(src, 'http://abc.supabase.co/storage/v1/object/public/homepage-media/videos/1.mp4').ok).toBe(false)
    expect(validateFieldValue(src, '/videos/nested/path.mp4').ok).toBe(false)
  })

  it('strict override validation rejects out-of-range video numbers (server side)', async () => {
    const { validateOverrides } = await import('./site-content/content')
    const bad = validateOverrides({ 'public.video.desktop_height': '500' })
    expect(bad.ok).toBe(false)
    const good = validateOverrides({ 'public.video.desktop_height': '60', 'public.video.enabled': 'false' })
    expect(good.ok).toBe(true)
  })
})
