import '../core/date.dart';
import '../data/models.dart';

/// Formula / flashcard scheduling, the same rules as the website's decks page.
///
/// The rungs come from Settings (`revision_gaps`, default [1, 7, 30]); `reviews` is how far
/// up the ladder the card has climbed. Every rating is deterministic for a given card,
/// ladder and day:
///
/// - Again: back to the bottom rung and due again today.
/// - Hard:  stays on its rung and returns tomorrow.
/// - Good:  waits the current rung's gap, then moves up one rung.
/// - Easy:  waits the next rung's gap, then moves up two rungs.
///
/// Days count from today's India (IST) date ([todayIso]).
const List<int> defaultCardLadder = <int>[1, 7, 30];

const List<String> cardRatings = <String>['again', 'hard', 'good', 'easy'];

const Map<String, String> cardRatingLabels = <String, String>{
  'again': 'Again',
  'hard': 'Hard',
  'good': 'Good',
  'easy': 'Easy',
};

/// The coarse label kept in `difficulty` (the database allows easy / known / difficult).
const Map<String, String> _difficultyFor = <String, String>{
  'again': 'difficult',
  'hard': 'difficult',
  'good': 'known',
  'easy': 'easy',
};

List<int> _ladder(List<int>? gaps) {
  final List<int> clean =
      (gaps ?? defaultCardLadder).where((int gap) => gap > 0).toList();
  return clean.isEmpty ? <int>[1] : clean;
}

int nextIntervalDays(int reviewsCompleted, List<int>? gaps) {
  final List<int> rungs = _ladder(gaps);
  final int index = reviewsCompleted.clamp(0, rungs.length - 1);
  return rungs[index];
}

/// Legacy names still map onto the four ratings.
String normaliseRating(String rating) {
  switch (rating) {
    case 'known':
    case 'okay':
      return 'good';
    case 'difficult':
      return 'hard';
    default:
      return cardRatings.contains(rating) ? rating : 'good';
  }
}

/// Days until the next review and the new rung count for one rating.
({int days, int reviews}) scheduleFor(
    int reviews, String rating, List<int>? gaps) {
  final int current = reviews < 0 ? 0 : reviews;
  switch (normaliseRating(rating)) {
    case 'again':
      return (days: 0, reviews: 0);
    case 'hard':
      return (days: 1, reviews: current);
    case 'easy':
      return (days: nextIntervalDays(current + 1, gaps), reviews: current + 2);
    case 'good':
    default:
      return (days: nextIntervalDays(current, gaps), reviews: current + 1);
  }
}

String ratingPreview(StudyCard card, String rating, List<int>? gaps) {
  final int days = scheduleFor(card.reviews, rating, gaps).days;
  return days == 0 ? 'today' : '$days day${days == 1 ? '' : 's'}';
}

/// Applies one review and schedules the next date. The row keeps the same id so the
/// website sees the same card.
StudyCard reviewCard(StudyCard card, String rating,
    {List<int>? gaps, String? today, String? now}) {
  final String value = normaliseRating(rating);
  final String day = today ?? todayIso();
  final ({int days, int reviews}) next = scheduleFor(card.reviews, value, gaps);
  return card.copyWith(
    difficulty: _difficultyFor[value],
    lastRating: value,
    reviews: next.reviews,
    lastReviewedAt: now ?? isoNow(),
    nextReviewAt: '${addDays(day, next.days)}T00:00:00.000Z',
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

String cardLadderLabel(StudyCard card, [List<int>? gaps]) =>
    'R${nextIntervalDays(card.reviews, gaps)}';
