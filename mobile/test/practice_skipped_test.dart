import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/progress.dart';

void main() {
  test('older practice rows without skipped read as 0', () {
    final PracticeSession row = PracticeSession.fromMap(<String, dynamic>{
      'id': 'p1', 'user_id': 'u1', 'chapter_id': 'c1', 'practice_date': '2026-10-01',
      'attempted': 10, 'correct': 7, 'incorrect': 3,
    });
    expect(row.skipped, 0);
    expect(row.toMap()['skipped'], 0);
  });

  test('skipped round-trips and is not counted as incorrect or in accuracy', () {
    final PracticeSession row = PracticeSession.fromMap(<String, dynamic>{
      'id': 'p2', 'user_id': 'u1', 'chapter_id': 'c1', 'practice_date': '2026-10-02',
      'attempted': 20, 'correct': 15, 'incorrect': 5, 'skipped': 4,
    });
    expect(row.skipped, 4);
    expect(PracticeSession.fromMap(row.toMap()).skipped, 4);
    final PracticeAggregate agg = aggregatePractice(<PracticeSession>[
      row,
      const PracticeSession(id: 'p3', userId: 'u1', chapterId: 'c1', practiceDate: '2026-10-03', attempted: 10, correct: 10, incorrect: 0),
    ]);
    expect(agg.attempted, 30);
    expect(agg.incorrect, 5);
    expect(agg.skipped, 4);
    expect(agg.accuracy, closeTo(25 / 30 * 100, 1e-9));
  });
}
