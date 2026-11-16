import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PROMO_START_SCALE, promoScale } from './home-motion'

describe('promo frame scroll scale (t166)', () => {
  it('runs 65% → 100% while the frame enters, then holds at 100%', () => {
    expect(PROMO_START_SCALE).toBe(.65)
    expect(promoScale(800, 500, 800)).toBeCloseTo(.65)      // top edge at the viewport bottom
    expect(promoScale(1200, 500, 800)).toBeCloseTo(.65)     // still below the fold
    expect(promoScale(550, 500, 800)).toBeCloseTo(.825)     // halfway in
    expect(promoScale(300, 500, 800)).toBeCloseTo(1)        // whole frame visible
    expect(promoScale(-100, 500, 800)).toBeCloseTo(1)       // stays full size
  })

  it('reaches 100% when a frame taller than the viewport fills it', () => {
    expect(promoScale(400, 1000, 800)).toBeCloseTo(.825)
    expect(promoScale(0, 1000, 800)).toBeCloseTo(1)
  })

  it('uses a native view() timeline with the same range, transform only, off for reduced motion', () => {
    const css = readFileSync('src/styles/public.css', 'utf8')
    expect(css).toContain('@keyframes promo-grow { from { transform: scale(.65); } to { transform: scale(1); } }')
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*@supports \(animation-timeline: view\(\)\)/)
    expect(css).toContain('animation-range: entry 0% entry 100%;')
    expect(css).toContain('var(--promo-scale) * 1.05)')
  })

  it('shows the brand badge centred on the frame', () => {
    expect(readFileSync('src/components/public/PromoVideoPlayer.tsx', 'utf8')).toContain("PROMO_BADGE = 'STRACKER • by DYPOL LABS'")
    const css = readFileSync('src/styles/home.css', 'utf8')
    expect(css).toMatch(/\.pub-hp \.promo-badge \{[^}]*left: 50%;[^}]*transform: translateX\(-50%\);/)
  })
})
