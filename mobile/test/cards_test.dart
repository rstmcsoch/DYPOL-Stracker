import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/cards.dart';

StudyCard card({int reviews = 0, String? next}) => StudyCard(
      id: 'k1',
      userId: 'u1',
      chapterId: 'c1',
      kind: 'formula',
      front: 'v = u + at',
      back: 'first equation of motion',
      reviews: reviews,
      nextReviewAt: next,
    );

const List<int> gaps = <int>[1, 7, 30];

void main() {
  test('a new card is due immediately', () {
    expect(isCardDue(card(), today: '2026-01-10'), isTrue);
  });

  test('a future review date is not due', () {
    expect(
        isCardDue(card(next: '2026-02-01T00:00:00.000Z'), today: '2026-01-10'),
        isFalse);
    expect(
        isCardDue(card(next: '2026-01-10T00:00:00.000Z'), today: '2026-01-10'),
        isTrue);
  });

  test(
      'Again / Hard / Good / Easy follow the revision ladder deterministically',
      () {
    expect(scheduleFor(2, 'again', gaps), (days: 0, reviews: 0));
    expect(scheduleFor(1, 'hard', gaps), (days: 1, reviews: 1));
    expect(scheduleFor(0, 'good', gaps), (days: 1, reviews: 1));
    expect(scheduleFor(1, 'good', gaps), (days: 7, reviews: 2));
    expect(scheduleFor(0, 'easy', gaps), (days: 7, reviews: 2));
    expect(scheduleFor(5, 'easy', gaps), (days: 30, reviews: 7));
    expect(scheduleFor(0, 'good', <int>[2, 5, 12]), (days: 2, reviews: 1));
  });

  test('reviewing keeps the id and writes only database-allowed values', () {
    for (final String rating in cardRatings) {
      final StudyCard reviewed = reviewCard(card(reviews: 1), rating,
          gaps: gaps, today: '2026-01-10', now: '2026-01-10T06:00:00.000Z');
      expect(reviewed.id, 'k1');
      expect(reviewed.lastRating, rating);
      expect(<String>['easy', 'known', 'difficult'],
          contains(reviewed.difficulty));
    }
    final StudyCard good =
        reviewCard(card(reviews: 1), 'good', gaps: gaps, today: '2026-01-10');
    expect(good.reviews, 2);
    expect(good.nextReviewAt, '2026-01-17T00:00:00.000Z');
    expect(cardLadderLabel(good, gaps), 'R30');
    expect(
        reviewCard(card(reviews: 2), 'again', gaps: gaps, today: '2026-01-10')
            .nextReviewAt,
        '2026-01-10T00:00:00.000Z');
  });

  test('legacy rating names map onto the four ratings', () {
    expect(normaliseRating('okay'), 'good');
    expect(normaliseRating('known'), 'good');
    expect(normaliseRating('difficult'), 'hard');
  });

  test('ratingPreview labels each button', () {
    expect(
        cardRatings
            .map((String r) => ratingPreview(card(reviews: 1), r, gaps))
            .toList(),
        <String>['today', '1 day', '7 days', '30 days']);
  });

  test(
      'cards saved before last_rating existed still load; unknown values are dropped',
      () {
    final Map<String, dynamic> legacy = card(reviews: 1).toMap()
      ..remove('last_rating');
    expect(StudyCard.fromMap(legacy).lastRating, isNull);
    expect(
        StudyCard.fromMap(<String, dynamic>{...legacy, 'last_rating': 'meh'})
            .lastRating,
        isNull);
    final StudyCard rated =
        StudyCard.fromMap(<String, dynamic>{...legacy, 'last_rating': 'easy'});
    expect(rated.lastRating, 'easy');
    expect(rated.toMap()['last_rating'], 'easy');
  });

  test('dueCards keeps only what is due', () {
    final List<StudyCard> due = dueCards(<StudyCard>[
      card(),
      card(next: '2026-03-01T00:00:00.000Z'),
    ], today: '2026-01-10');
    expect(due.length, 1);
  });
}
