import { addDays, format, parseISO } from 'date-fns'
import type { CardDifficulty, CardRating, StudyCard } from '../../types/index.js'
import { indiaDate } from '../date.js'

export type { CardRating } from '../../types/index.js'

/**
 * Formula / flashcard scheduling on the same ladder as chapter revisions. The rungs come
 * from Settings (`revision_gaps`, default [1, 7, 30]); `reviews` is how far up the ladder
 * the card has climbed. Every rating is deterministic for a given card, ladder and day:
 *
 * - Again: back to the bottom rung and due again today.
 * - Hard:  stays on its rung and returns tomorrow.
 * - Good:  waits the current rung's gap, then moves up one rung.
 * - Easy:  waits the next rung's gap, then moves up two rungs.
 *
 * Days are counted from the review's India (IST) calendar date, so a late-night review is
 * scheduled from the day the student actually studied.
 */

export const RATING_LABELS: Record<CardRating, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' }

function ladder(gaps: number[]): number[] {
  const clean = gaps.filter(gap => Number.isInteger(gap) && gap > 0)
  return clean.length ? clean : [1]
}

export function nextIntervalDays(reviewsCompleted: number, gaps: number[]): number {
  const rungs = ladder(gaps)
  const index = Math.min(Math.max(reviewsCompleted, 0), rungs.length - 1)
  return rungs[index] ?? 1
}

/** Days until the next review and the new rung count for one rating. */
export function scheduleFor(reviews: number, rating: CardRating, gaps: number[]): { days: number; reviews: number } {
  const current = Math.max(0, reviews)
  switch (rating) {
    case 'again': return { days: 0, reviews: 0 }
    case 'hard': return { days: 1, reviews: current }
    case 'good': return { days: nextIntervalDays(current, gaps), reviews: current + 1 }
    case 'easy': return { days: nextIntervalDays(current + 1, gaps), reviews: current + 2 }
  }
}

const DIFFICULTY_FOR: Record<CardRating, CardDifficulty> = { again: 'difficult', hard: 'difficult', good: 'known', easy: 'easy' }

/** Legacy two-button names still map onto the four ratings. */
export function normaliseRating(rating: CardRating | 'known' | 'difficult'): CardRating {
  return rating === 'known' ? 'good' : rating === 'difficult' ? 'hard' : rating
}

export function reviewCard(card: StudyCard, rating: CardRating | 'known' | 'difficult', gaps: number[], reviewedAt: Date): StudyCard {
  const value = normaliseRating(rating)
  const reviewedIso = reviewedAt.toISOString()
  const { days, reviews } = scheduleFor(card.reviews, value, gaps)
  const reviewDay = indiaDate(reviewedAt)
  const nextDay = format(addDays(parseISO(`${reviewDay}T12:00:00`), days), 'yyyy-MM-dd')
  return {
    ...card,
    reviews,
    difficulty: DIFFICULTY_FOR[value],
    last_rating: value,
    last_reviewed_at: reviewedIso,
    next_review_at: `${nextDay}T00:00:00.000Z`,
    updated_at: reviewedIso
  }
}

/** A short preview for each button, e.g. "today", "1 day", "7 days". */
export function ratingPreview(card: StudyCard, rating: CardRating, gaps: number[]): string {
  const { days } = scheduleFor(card.reviews, rating, gaps)
  return days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`
}

export function isCardDue(card: StudyCard, today: string): boolean {
  if (!card.next_review_at) return true
  return card.next_review_at.slice(0, 10) <= today
}

export function dueCards(cards: StudyCard[], today: string, chapterId?: string): StudyCard[] {
  return cards
    .filter(card => (chapterId ? card.chapter_id === chapterId : true) && isCardDue(card, today))
    .sort((a, b) => (a.next_review_at ?? '').localeCompare(b.next_review_at ?? '') || a.position - b.position)
}
