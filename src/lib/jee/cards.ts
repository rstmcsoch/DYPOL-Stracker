import { addDays, format, parseISO } from 'date-fns'
import type { CardDifficulty, StudyCard } from '../../types/index.js'

/**
 * Flashcard / formula scheduling on the same R1 → R7 → R30 ladder as chapter revisions.
 * The gaps come from Settings (`revision_gaps`, default [1, 7, 30]). Scheduling uses the
 * real completion timestamp of the review, so a late review pushes the next one out from
 * the day it actually happened.
 */

export type CardRating = 'known' | 'difficult'

export function nextIntervalDays(reviewsCompleted: number, gaps: number[]): number {
  if (!gaps.length) return 1
  const index = Math.min(Math.max(reviewsCompleted, 0), gaps.length - 1)
  return Math.max(1, gaps[index] ?? 1)
}

/** Scheduling a review: "known" moves along the ladder; "difficult" returns tomorrow and does not advance it. */
export function reviewCard(card: StudyCard, rating: CardRating, gaps: number[], reviewedAt: Date): StudyCard {
  const reviewedIso = reviewedAt.toISOString()
  const reviewsBefore = card.reviews
  const days = rating === 'difficult' ? 1 : nextIntervalDays(reviewsBefore, gaps)
  const reviewDay = format(reviewedAt, 'yyyy-MM-dd')
  const nextDay = format(addDays(parseISO(`${reviewDay}T12:00:00`), days), 'yyyy-MM-dd')
  const difficulty: CardDifficulty = rating === 'difficult' ? 'difficult' : 'known'
  return {
    ...card,
    reviews: rating === 'known' ? reviewsBefore + 1 : reviewsBefore,
    difficulty,
    last_reviewed_at: reviewedIso,
    next_review_at: `${nextDay}T00:00:00.000Z`,
    updated_at: reviewedIso
  }
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
