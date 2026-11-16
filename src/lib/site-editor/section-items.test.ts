import { describe, expect, it } from 'vitest'
import { overridesFromValues, resolveSiteValues } from '../site-content/content'
import { normalizeDocument, setProp } from '../../control/live-editor/doc-ops'
import { adoptItems } from '../../control/live-editor/registry-map'
import { compactDocument } from '../../control/live-editor/doc-ops'
import { checkSiteDocument } from './validate'
import { itemsFromSlots, managedSlotKeys, resetSlots } from './section-items'

describe('Stracker card lists as document items', () => {
  it('derives exactly what the site shows today from the registry slots', () => {
    const values = resolveSiteValues({})
    const features = itemsFromSlots('stracker.features', values)
    expect(features).toHaveLength(8)
    expect(features[0]).toMatchObject({ title: values['public.features.item_1.title'], icon: values['public.features.item_1.icon'], hidden: false })
    expect(Array.isArray(features[0]!.points)).toBe(true)
    expect(itemsFromSlots('stracker.principles', values)).toHaveLength(6)
    expect(itemsFromSlots('stracker.how', values)).toHaveLength(4)
    expect(itemsFromSlots('stracker.privacy', values)).toHaveLength(6)
  })

  it('keeps the owner order, and keeps edited hidden slots as hidden items', () => {
    const values = resolveSiteValues({ 'public.features.order': '3,1', 'public.features.item_2.title': 'Edited but hidden' })
    const items = itemsFromSlots('stracker.features', values)
    expect(items.map(item => [item.title, item.hidden])).toEqual([
      [values['public.features.item_3.title'], false], [values['public.features.item_1.title'], false], ['Edited but hidden', true]
    ])
  })

  it('moving a list into the document resets its slots, so no value lives in two places', () => {
    const values = resolveSiteValues({ 'public.how.step_2.title': 'Record everything', 'public.hero.title': 'Kept' })
    const working = { values, document: normalizeDocument(null) }
    const adopted = adoptItems(working, 'home', 'home-how')
    const overrides = overridesFromValues(adopted.values)
    expect(overrides['public.how.step_2.title']).toBeUndefined()
    expect(overrides['public.hero.title']).toBe('Kept')
    const how = adopted.document.pages.home!.blocks.find(block => block.id === 'home-how')!
    expect((how.props!.items as Array<{ title: string }>)[1]!.title).toBe('Record everything')
    // Stored document passes the same strict validation the API runs.
    expect(checkSiteDocument(compactDocument(adopted.document)).problems).toEqual([])
    // Second adoption is a no-op.
    expect(adoptItems(adopted, 'home', 'home-how')).toBe(adopted)
    expect(managedSlotKeys(adopted.document)('public.how.step_1.body')).toBe(true)
    expect(managedSlotKeys(adopted.document)('public.how.title')).toBe(false)
    expect(managedSlotKeys(working.document)('public.how.step_1.body')).toBe(false)
  })

  it('every adopted list validates, and caps are enforced', () => {
    const values = resolveSiteValues({})
    let working = { values, document: normalizeDocument(null) }
    for (const id of ['home-features', 'home-principles', 'home-how', 'home-privacy']) working = adoptItems(working, 'home', id)
    expect(checkSiteDocument(compactDocument(working.document)).problems).toEqual([])
    const tooMany = setProp(working.document, 'home', 'home-how', 'items', Array.from({ length: 9 }, () => ({ title: 'Step', body: 'Body', hidden: false })))
    expect(checkSiteDocument(compactDocument(tooMany)).problems.length).toBeGreaterThan(0)
    expect(resetSlots('stracker.features', resolveSiteValues({ 'public.features.order': '1,2' }))['public.features.order']).toBe(resolveSiteValues({})['public.features.order'])
  })
})
