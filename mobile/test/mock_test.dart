import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/mock.dart';

void main() {
  test('a mock with no error log is reported as empty, not as a perfect score', () {
    final AppData data = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      tests: const <TestRecord>[
        TestRecord(
          id: 't1',
          userId: 'u1',
          title: 'Full mock 1',
          testDate: '2026-01-05',
          testType: 'Full Mock',
          marksObtained: 150,
          totalMarks: 300,
        ),
      ],
    );
    final MockAnalysis analysis = analyseMock(data, data.tests.single);
    expect(analysis.isEmpty, isTrue);
    expect(analysis.insights, isNotEmpty, reason: 'the page still explains what to add');
  });

  test('error categories and lost marks are aggregated from the log', () {
    final AppData data = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      tests: const <TestRecord>[
        TestRecord(
          id: 't1',
          userId: 'u1',
          title: 'Full mock 1',
          testDate: '2026-01-05',
          testType: 'Full Mock',
          marksObtained: 150,
          totalMarks: 300,
        ),
      ],
      errorLogs: const <TestErrorLog>[
        TestErrorLog(id: 'e1', userId: 'u1', testId: 't1', subject: 'Physics', category: 'Silly mistake', marksLost: 8, questions: 2),
        TestErrorLog(id: 'e2', userId: 'u1', testId: 't1', subject: 'Physics', category: 'Silly mistake', marksLost: 4, questions: 1),
        TestErrorLog(id: 'e3', userId: 'u1', testId: 't1', subject: 'Maths', category: 'Concept gap', marksLost: 12, questions: 3),
      ],
      timeEntries: const <TestTimeEntry>[
        TestTimeEntry(id: 'x1', userId: 'u1', testId: 't1', subject: 'Physics', minutes: 40, attempted: 18, unattempted: 2),
        TestTimeEntry(id: 'x2', userId: 'u1', testId: 't1', subject: 'Maths', minutes: 50, attempted: 20, unattempted: 5),
      ],
    );
    final MockAnalysis analysis = analyseMock(data, data.tests.single);
    expect(analysis.isEmpty, isFalse);
    expect(analysis.totalLost, 24);
    final CategoryLoss silly = analysis.byCategory.firstWhere((CategoryLoss c) => c.category == 'Silly mistake');
    expect(silly.marksLost, 12);
    expect(silly.questions, 3);
    expect(silly.entries, 2);
    expect(analysis.bySubject.map((SubjectTime s) => s.subject), containsAll(<String>['Physics', 'Maths']));
  });

  test('only mock tests appear in the mock picker', () {
    final AppData data = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      tests: const <TestRecord>[
        TestRecord(id: 't1', userId: 'u1', title: 'Full mock', testDate: '2026-01-05', testType: 'Full Mock'),
        TestRecord(id: 't2', userId: 'u1', title: 'Chapter test', testDate: '2026-01-06', testType: 'Chapter Test'),
      ],
    );
    expect(mockTests(data).map((TestRecord t) => t.id), <String>['t1']);
  });
}
