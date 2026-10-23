import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/analytics.dart';

void main() {
  group('validPercentage', () {
    test('accepts whole totals and half marks', () {
      expect(validPercentage(48, 100), 48);
      expect(validPercentage(48.5, 100), 48.5);
      expect(validPercentage(0, 80), 0);
      expect(validPercentage(80, 80), 100);
    });

    test('rejects impossible input instead of guessing', () {
      expect(validPercentage(null, 100), isNull);
      expect(validPercentage(10, null), isNull);
      expect(validPercentage(10, 0), isNull);
      expect(validPercentage(-1, 100), isNull);
      expect(validPercentage(101, 100), isNull);
      // Quarter marks are not part of the JEE marking scheme.
      expect(validPercentage(10.25, 100), isNull);
      // Fractional totals are not a real paper.
      expect(validPercentage(10, 33.5), isNull);
    });
  });

  group('full mock aggregation', () {
    TestSubjectScore row(String id, String subject, double marks, double total) =>
        TestSubjectScore(id: id, userId: 'u1', testId: 't1', subject: subject, marksObtained: marks, totalMarks: total);

    test('sums a complete JEE mock', () {
      final List<TestSubjectScore> scores = <TestSubjectScore>[
        row('s1', 'Physics', 40, 100),
        row('s2', 'Chemistry', 50, 100),
        row('s3', 'Maths', 60, 100),
      ];
      final MarksTotal? total = fullMockAggregate('t1', scores);
      expect(total, isNotNull);
      expect(total!.marks, 150);
      expect(total.total, 300);
    });

    test('refuses a partial mock', () {
      final List<TestSubjectScore> scores = <TestSubjectScore>[
        row('s1', 'Physics', 40, 100),
        row('s2', 'Chemistry', 50, 100),
      ];
      expect(fullMockAggregate('t1', scores), isNull);
    });

    test('refuses duplicate subject rows', () {
      final List<TestSubjectScore> scores = <TestSubjectScore>[
        row('s1', 'Physics', 40, 100),
        row('s2', 'Physics', 44, 100),
        row('s3', 'Maths', 60, 100),
      ];
      expect(fullMockAggregate('t1', scores), isNull);
    });

    test('overall percentage prefers the subject rows for a full mock', () {
      final TestRecord test = TestRecord(
        id: 't1',
        userId: 'u1',
        title: 'Full mock 3',
        testDate: '2026-01-10',
        testType: 'Full Mock',
      );
      final List<TestSubjectScore> scores = <TestSubjectScore>[
        row('s1', 'Physics', 40, 100),
        row('s2', 'Chemistry', 50, 100),
        row('s3', 'Maths', 60, 100),
      ];
      expect(overallTestPercentage(test, scores), closeTo(50, 0.001));
    });
  });

  test('meanTestPercentage ignores tests without a valid score', () {
    final List<TestRecord> tests = <TestRecord>[
      TestRecord(id: 't1', userId: 'u1', title: 'A', testDate: '2026-01-01', testType: 'Chapter Test', marksObtained: 40, totalMarks: 80),
      TestRecord(id: 't2', userId: 'u1', title: 'B', testDate: '2026-01-02', testType: 'Chapter Test'),
    ];
    final MeanResult mean = meanTestPercentage(tests, const <TestSubjectScore>[]);
    expect(mean.count, 1);
    expect(mean.average, closeTo(50, 0.001));
  });
}
