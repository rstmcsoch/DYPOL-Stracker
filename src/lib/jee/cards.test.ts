import { describe, expect, it } from 'vitest'
import { reviewCard, ratingPreview, scheduleFor } from './cards'
import { validatePersistedRecords } from '../record-validation'
import { studyCardSchema } from '../jee-record-schemas'
import type { StudyCard } from '../../types'

const USER = '00000000-0000-4000-8000-000000000001'
const CHAPTER = '00000000-0000-4000-8000-0000000000c1'
const NOW = '2026-10-08T06:00:00.000Z'
const card = (overrides: Partial<StudyCard> = {}): StudyCard => ({
  id: '00000000-0000-4000-8000-0000000000a1', user_id: USER, chapter_id: CHAPTER, kind: 'formula', front: 'F', back: 'B', hint: '', position: 0,
  difficulty: null, reviews: 0, last_reviewed_at: null, next_review_at: null, created_at: NOW, updated_at: NOW, ...overrides
})
const at = new Date('2026-10-08T06:00:00.000Z') // 11:30 IST, 8 Oct

describe('Again / Hard / Good / Easy scheduling', () => {
  const gaps = [1, 7, 30]

  it('is deterministic and follows the revision_gaps ladder', () => {
    expect(scheduleFor(0, 'again', gaps)).toEqual({ days: 0, reviews: 0 })
    expect(scheduleFor(2, 'again', gaps)).toEqual({ days: 0, reviews: 0 })
    expect(scheduleFor(1, 'hard', gaps)).toEqual({ days: 1, reviews: 1 })
    expect(scheduleFor(0, 'good', gaps)).toEqual({ days: 1, reviews: 1 })
    expect(scheduleFor(1, 'good', gaps)).toEqual({ days: 7, reviews: 2 })
    expect(scheduleFor(0, 'easy', gaps)).toEqual({ days: 7, reviews: 2 })
    expect(scheduleFor(5, 'easy', gaps)).toEqual({ days: 30, reviews: 7 })
    expect(reviewCard(card({ reviews: 1 }), 'good', gaps, at)).toEqual(reviewCard(card({ reviews: 1 }), 'good', gaps, at))
  })

  it('uses custom gaps from Settings', () => {
    expect(scheduleFor(0, 'good', [2, 5, 12, 40])).toEqual({ days: 2, reviews: 1 })
    expect(scheduleFor(2, 'easy', [2, 5, 12, 40])).toEqual({ days: 40, reviews: 4 })
    expect(scheduleFor(0, 'good', [])).toEqual({ days: 1, reviews: 1 })
  })

  it('writes difficulty and the dedicated last_rating field', () => {
    const again = reviewCard(card({ reviews: 2 }), 'again', gaps, at)
    expect(again).toMatchObject({ reviews: 0, difficulty: 'difficult', last_rating: 'again', next_review_at: '2026-10-08T00:00:00.000Z' })
    expect(reviewCard(card(), 'hard', gaps, at)).toMatchObject({ difficulty: 'difficult', last_rating: 'hard', next_review_at: '2026-10-09T00:00:00.000Z' })
    expect(reviewCard(card(), 'good', gaps, at)).toMatchObject({ difficulty: 'known', last_rating: 'good', next_review_at: '2026-10-09T00:00:00.000Z' })
    expect(reviewCard(card(), 'easy', gaps, at)).toMatchObject({ difficulty: 'easy', last_rating: 'easy', next_review_at: '2026-10-15T00:00:00.000Z' })
  })

  it('counts days from the IST calendar date of the review', () => {
    // 00:30 IST on 9 Oct is still 8 Oct in UTC; the next review must be counted from 9 Oct.
    const lateNight = new Date('2026-10-08T19:00:00.000Z')
    expect(reviewCard(card(), 'good', gaps, lateNight).next_review_at).toBe('2026-10-10T00:00:00.000Z')
  })

  it('maps the legacy Known / Difficult names onto Good / Hard', () => {
    expect(reviewCard(card(), 'known', gaps, at).last_rating).toBe('good')
    expect(reviewCard(card(), 'difficult', gaps, at).last_rating).toBe('hard')
  })

  it('previews each button', () => {
    expect(['again', 'hard', 'good', 'easy'].map(rating => ratingPreview(card({ reviews: 1 }), rating as 'good', gaps))).toEqual(['today', '1 day', '7 days', '30 days'])
  })
})

describe('existing cards keep loading', () => {
  it('accepts a card saved before last_rating existed, and rejects unknown ratings', () => {
    const legacy = card({ difficulty: 'known', reviews: 1 })
    delete (legacy as Partial<StudyCard>).last_rating
    expect(studyCardSchema.safeParse(legacy).success).toBe(true)
    expect(() => validatePersistedRecords('study_cards', [legacy as unknown as Record<string, unknown>])).not.toThrow()
    expect(studyCardSchema.safeParse({ ...legacy, last_rating: null }).success).toBe(true)
    expect(studyCardSchema.safeParse({ ...legacy, last_rating: 'meh' }).success).toBe(false)
    expect(() => validatePersistedRecords('study_cards', [{ ...legacy, last_rating: 'meh' } as unknown as Record<string, unknown>])).toThrow()
  })

  it('keeps last_rating through the backup schema', () => {
    const parsed = studyCardSchema.parse({ ...card(), last_rating: 'easy' })
    expect(parsed.last_rating).toBe('easy')
  })
})
