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

void main() {
  test('a new card is due immediately', () {
    expect(isCardDue(card(), today: '2026-01-10'), isTrue);
  });

  test('a future review date is not due', () {
    expect(isCardDue(card(next: '2026-02-01T00:00:00.000Z'), today: '2026-01-10'), isFalse);
    expect(isCardDue(card(next: '2026-01-10T00:00:00.000Z'), today: '2026-01-10'), isTrue);
  });

  test('reviewing advances the ladder and keeps the id', () {
    final StudyCard reviewed = reviewCard(card(), 'okay', today: '2026-01-10');
    expect(reviewed.id, 'k1');
    expect(reviewed.reviews, 1);
    expect(reviewed.difficulty, 'okay');
    expect(reviewed.nextReviewAt, startsWith('2026-01-17'));
    expect(cardLadderLabel(reviewed), 'R7');
  });

  test('difficult pulls the interval back', () {
    final StudyCard reviewed = reviewCard(card(reviews: 3), 'difficult', today: '2026-01-10');
    expect(reviewed.nextReviewAt, startsWith('2026-01-17'));
  });

  test('dueCards keeps only what is due', () {
    final List<StudyCard> due = dueCards(<StudyCard>[
      card(),
      card(next: '2026-03-01T00:00:00.000Z'),
    ], today: '2026-01-10');
    expect(due.length, 1);
  });
}
