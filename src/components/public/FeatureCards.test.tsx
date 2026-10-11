// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SiteContentProvider } from '../../contexts/SiteContentContext'
import { validateFieldValue } from '../../lib/site-content/content'
import { SITE_CONTENT_DEFAULTS, fieldDefinition } from '../../lib/site-content/registry'
import { FeatureSection, PrincipleSection } from './LandingSections'

afterEach(cleanup)

function titles(overrides: Record<string, string>) {
  const { container } = render(<SiteContentProvider overrides={overrides}><FeatureSection /></SiteContentProvider>)
  return { container, list: [...container.querySelectorAll('.feature-entry h3')].map(node => node.textContent) }
}

describe('owner feature card order, visibility and icons', () => {
  it('renders all eight cards in the original order by default', () => {
    const { list, container } = titles({})
    expect(list).toHaveLength(8)
    expect(list[0]).toBe(SITE_CONTENT_DEFAULTS['public.features.item_1.title'])
    expect(container.querySelector('.feature-toggle')).not.toBeNull()
  })

  it('reorders and hides cards, renumbering what is shown', () => {
    const { list, container } = titles({ 'public.features.order': '3,1' })
    expect(list).toEqual([SITE_CONTENT_DEFAULTS['public.features.item_3.title'], SITE_CONTENT_DEFAULTS['public.features.item_1.title']])
    expect([...container.querySelectorAll('.feature-index')].map(node => node.textContent)).toEqual(['01', '02'])
    expect(container.querySelector('.feature-toggle')).toBeNull()
  })

  it('falls back to the full default order for an invalid stored value', () => {
    expect(titles({ 'public.features.order': '1,1,13' }).list).toHaveLength(8)
  })

  it('validates order values strictly', () => {
    const order = fieldDefinition('public.features.order')!
    expect(validateFieldValue(order, ' 2, 1 ')).toEqual({ ok: true, value: '2,1' })
    expect(validateFieldValue(order, '1').ok).toBe(false)
    expect(validateFieldValue(order, '1,1').ok).toBe(false)
    expect(validateFieldValue(order, '1,13').ok).toBe(false)
    expect(validateFieldValue(order, '1;2').ok).toBe(false)
  })

  it('adds a new card by showing an extra slot, up to the limit', () => {
    const { list } = titles({ 'public.features.order': '1,9', 'public.features.item_9.title': 'Doubt log' })
    expect(list).toEqual([SITE_CONTENT_DEFAULTS['public.features.item_1.title'], 'Doubt log'])
    expect(fieldDefinition('public.features.item_13.title')).toBeUndefined()
    expect(validateFieldValue(fieldDefinition('public.features.order')!, '1,13').ok).toBe(false)
  })

  it('shows an optional card image only when one is set', () => {
    const url = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/homepage-media/site/image/0f8fad5b-d9cb-469f-a165-70867728950e.webp'
    expect(titles({}).container.querySelector('.feature-image')).toBeNull()
    cleanup()
    const img = titles({ 'public.features.item_2.image': url }).container.querySelector('.feature-image')
    expect(img?.getAttribute('src')).toBe(url)
    expect(img?.getAttribute('alt')).toBe(SITE_CONTENT_DEFAULTS['public.features.item_2.title'])
    expect(validateFieldValue(fieldDefinition('public.features.item_2.image')!, 'https://evil.example/a.png').ok).toBe(false)
  })

  it('reorders, adds and re-icons principle items', () => {
    const { container } = render(<SiteContentProvider overrides={{}}><PrincipleSection /></SiteContentProvider>)
    expect(container.querySelectorAll('.principle-list > li')).toHaveLength(6)
    cleanup()
    const second = render(<SiteContentProvider overrides={{ 'public.principles.order': '7,2', 'public.principles.item_7.title': 'Exam-agnostic' }}><PrincipleSection /></SiteContentProvider>)
    expect([...second.container.querySelectorAll('.principle-list strong')].map(node => node.textContent)).toEqual(['Exam-agnostic', SITE_CONTENT_DEFAULTS['public.principles.item_2.title']])
    expect(validateFieldValue(fieldDefinition('public.principles.item_1.icon')!, 'target').ok).toBe(true)
  })

  it('only accepts icons from the allowlist', () => {
    const icon = fieldDefinition('public.features.item_1.icon')!
    expect(validateFieldValue(icon, 'target').ok).toBe(true)
    expect(validateFieldValue(icon, 'skull').ok).toBe(false)
  })
})
