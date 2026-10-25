import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/mock.dart';

void main() {
  test('stableId matches the website id for the same namespace', () {
    // Reference values produced by src/lib/id.ts stableId in Node.
    expect(stableId('abc-123:time:Physics'), 'f8a78c7a-a9e7-51ce-af36-72fe85bf5fc6');
    expect(stableId('Ünï:time:Maths'), '22e054ae-b9d3-5924-a30c-918670d5163c');
  });

  AppData sample() => AppData(
        userId: 'u1',
        settings: AppSettings.defaults('u1'),
        tests: const <TestRecord>[
          TestRecord(id: 't1', userId: 'u1', title: 'Mock', testDate: '2026-01-05', testType: 'Full Mock'),
        ],
        testSubjectScores: const <TestSubjectScore>[
          TestSubjectScore(
              id: 's1', userId: 'u1', testId: 't1', subject: 'Physics', marksObtained: 60, totalMarks: 100),
          TestSubjectScore(
              id: 's2', userId: 'u1', testId: 't1', subject: 'Chemistry', marksObtained: 40, totalMarks: 100),
        ],
        timeEntries: const <TestTimeEntry>[
          TestTimeEntry(
            id: 'e1',
            userId: 'u1',
            testId: 't1',
            subject: 'Physics',
            label: '',
            minutes: 60,
            attempted: 20,
            unattempted: 5,
          ),
        ],
        errorLogs: const <TestErrorLog>[
          TestErrorLog(
              id: 'l1',
              userId: 'u1',
              testId: 't1',
              subject: 'Physics',
              category: 'Silly mistake',
              marksLost: 12,
              questions: 3),
          TestErrorLog(
              id: 'l2',
              userId: 'u1',
              testId: 't1',
              subject: 'Physics',
              category: 'Concept gap',
              marksLost: 4,
              questions: 1),
          TestErrorLog(id: 'l3', userId: 'u1', testId: 't1', category: 'Time pressure', marksLost: 8),
        ],
      );

  test('summary, category totals and time rows follow the website', () {
    final AppData data = sample();
    final TestRecord test = data.tests.single;
    final ({double? score, int taggedQuestions, double? taggedMarks}) summary = mockSummary(test, data);
    expect(summary.score, isNull, reason: 'an incomplete Full Mock has no aggregate score, as on the website');
    expect(summary.taggedQuestions, 4);
    expect(summary.taggedMarks, 24);

    final List<CategoryTotal> totals = categoryTotals(data.errorLogs);
    expect(totals.map((CategoryTotal t) => t.category), <String>['Silly mistake', 'Concept gap', 'Time pressure']);
    expect(totals.last.questions, isNull, reason: 'no row recorded questions, so it stays blank');

    final List<SubjectTimeRow> rows = subjectTimeRows(test, data);
    final SubjectTimeRow physics = rows.firstWhere((SubjectTimeRow r) => r.subject == 'Physics');
    expect(physics.minutes, 60);
    expect(physics.marksPerMinute, closeTo(1, 0.0001));
    final SubjectTimeRow chemistry = rows.firstWhere((SubjectTimeRow r) => r.subject == 'Chemistry');
    expect(chemistry.minutes, isNull, reason: 'nothing is estimated');
    expect(chemistry.marksPerMinute, isNull);
  });

  test('insights carry their basis and the website wording', () {
    final AppData data = sample();
    final List<MockInsight> insights = mockInsights(data.tests.single, data);
    final List<String> texts = insights.map((MockInsight i) => i.text).toList();
    expect(texts, contains('Physics lost 16 marks; 75% of that came from silly mistake.'));
    expect(texts, contains('Physics: 3 questions were lost to avoidable slips (silly, calculation or misread).'));
    expect(texts, contains('Physics: 60 min spent for 60 of 100 marks (60%).'));
    expect(texts, contains('Physics: 5 questions left unattempted.'));
    expect(texts, contains('You tagged 8 marks as lost to time pressure.'));
    expect(insights.firstWhere((MockInsight i) => i.text.startsWith('You tagged')).kind, 'classified');
  });
}
