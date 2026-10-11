// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SiteContentProvider } from '../../contexts/SiteContentContext'
import { validateFieldValue } from '../../lib/site-content/content'
import { fieldDefinition } from '../../lib/site-content/registry'
import { PromoVideoSection } from './PromoVideoPlayer'

beforeAll(() => {
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  vi.stubGlobal('IntersectionObserver', Observer)
})
afterEach(cleanup)

function renderWith(overrides: Record<string, string>) {
  return render(<SiteContentProvider overrides={overrides}><PromoVideoSection /></SiteContentProvider>)
}

describe('owner promo video controls', () => {
  it('renders the original layout by default', () => {
    const { container } = renderWith({})
    const section = container.querySelector('section.pub-section-promo')
    expect(section?.className).toContain('promo-size-medium')
    expect(section?.className).toContain('promo-aspect-portrait')
    expect(section?.className).toContain('promo-pos-center')
    expect(container.querySelector('#promo-title')?.className).toBe('visually-hidden')
  })

  it('hides the whole section and its video when switched off', () => {
    const { container } = renderWith({ 'public.promo.visibility': 'hide' })
    expect(container.querySelector('section')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
  })

  it('shows the owner heading and applies presets', () => {
    const { container, getByRole } = renderWith({
      'public.promo.heading_visibility': 'visible', 'public.promo.heading': 'Watch it work',
      'public.promo.size': 'large', 'public.promo.aspect': '16:9', 'public.promo.position': 'left'
    })
    expect(getByRole('heading', { level: 2 }).textContent).toBe('Watch it work')
    const section = container.querySelector('section.pub-section-promo')
    expect(section?.className).toContain('promo-size-large')
    expect(section?.className).toContain('promo-aspect-landscape')
    expect(section?.className).toContain('promo-pos-left')
  })

  it('falls back to defaults for invalid stored choices', () => {
    const { container } = renderWith({ 'public.promo.size': 'huge', 'public.promo.aspect': '<script>' })
    const section = container.querySelector('section.pub-section-promo')
    expect(section?.className).toContain('promo-size-medium')
    expect(section?.className).toContain('promo-aspect-portrait')
  })

  it('uses owner-uploaded media with the built-in clip as fallback', () => {
    const video = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/homepage-media/site/video/0f8fad5b-d9cb-469f-a165-70867728950e.mp4'
    const poster = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/homepage-media/site/image/0f8fad5b-d9cb-469f-a165-70867728950e.webp'
    const { container } = renderWith({ 'public.promo.video_src': video, 'public.promo.poster_src': poster })
    expect(container.querySelector('video')?.getAttribute('poster')).toBe(poster)
  })

  it('accepts only built-in or uploaded media URLs', () => {
    const video = fieldDefinition('public.promo.video_src')!
    expect(validateFieldValue(video, '/videos/stracker-ad1-web.mp4').ok).toBe(true)
    expect(validateFieldValue(video, 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/homepage-media/site/video/0f8fad5b-d9cb-469f-a165-70867728950e.mp4').ok).toBe(true)
    expect(validateFieldValue(video, 'https://evil.example/clip.mp4').ok).toBe(false)
    expect(validateFieldValue(video, '/videos/other.mp4').ok).toBe(false)
  })

  it('validates select fields strictly', () => {
    const size = fieldDefinition('public.promo.size')!
    expect(validateFieldValue(size, 'small')).toEqual({ ok: true, value: 'small' })
    expect(validateFieldValue(size, 'gigantic').ok).toBe(false)
    expect(validateFieldValue(size, 42).ok).toBe(false)
  })
})
