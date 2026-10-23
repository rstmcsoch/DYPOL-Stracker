import '../core/date.dart';
import '../data/models.dart';

/// Formula/flashcard review ladder: R1 → R7 → R30 (then stay on the 30-day rung).
/// Difficulty nudges the interval down or up, exactly like the web decks page.
const List<int> cardLadder = <int>[1, 7, 30];

int nextIntervalDays(int reviews, String? difficulty) {
  int rung = reviews.clamp(0, cardLadder.length - 1);
  if (difficulty == 'difficult') rung = (rung - 1).clamp(0, cardLadder.length - 1);
  if (difficulty == 'easy' && reviews >= cardLadder.length) rung = cardLadder.length - 1;
  return cardLadder[rung];
}

/// Applies one review: increments the counter, stores difficulty and schedules the
/// next date. The row keeps the same id so the website sees the same card.
StudyCard reviewCard(StudyCard card, String difficulty, {String? today}) {
  final String day = today ?? todayIso();
  final int reviews = card.reviews + 1;
  final int interval = nextIntervalDays(reviews, difficulty);
  return card.copyWith(
    difficulty: difficulty,
    reviews: reviews,
    lastReviewedAt: isoNow(),
    nextReviewAt: '${addDays(day, interval)}T00:00:00.000Z',
  );
}

bool isCardDue(StudyCard card, {String? today}) {
  final String day = today ?? todayIso();
  final String? next = card.nextReviewAt;
  if (next == null || next.isEmpty) return true;
  return next.substring(0, 10).compareTo(day) <= 0;
}

List<StudyCard> dueCards(List<StudyCard> cards, {String? today}) =>
    cards.where((StudyCard card) => isCardDue(card, today: today)).toList();

String cardLadderLabel(StudyCard card) {
  final int rung = (card.reviews).clamp(0, cardLadder.length - 1);
  return 'R${cardLadder[rung]}';
}
