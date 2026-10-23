import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/report.dart';

void main() {
  test('an empty notebook still produces a complete, honest report', () {
    const AppData empty = AppData(
      userId: 'u1',
      settings: AppSettings(id: 's1', userId: 'u1'),
    );
    final String html = buildPrintableReport(empty, owner: 'Rustam', generatedOn: '2026-10-23');

    expect(html, startsWith('<!doctype html>'));
    expect(html, contains('<h1>Study report</h1>'));
    expect(html, contains('Rustam · generated 2026-10-23'));
    // Every section is present...
    for (final String heading in <String>[
      'Exam setup',
      'Syllabus',
      'Tests',
      'Mistakes',
      'Study time',
    ]) {
      expect(html, contains(heading), reason: 'missing section $heading');
    }
    // ...and empty ones say so instead of printing zero as if it were data.
    expect(html, contains('No tests recorded yet.'));
    expect(html, contains('No mistakes logged yet.'));
    expect(html, contains('No chapters recorded yet.'));
    // Nothing from the implementation leaks into a document a student may print.
    for (final String internalWord in <String>['supabase', 'postgres', 'vercel', 'jwt']) {
      expect(html.toLowerCase(), isNot(contains(internalWord)));
    }
  });

  test('user-typed text is escaped, never injected as markup', () {
    final AppData data = AppData(
      userId: 'u1',
      settings: const AppSettings(id: 's1', userId: 'u1'),
      tests: <TestRecord>[
        TestRecord(
          id: 't1',
          userId: 'u1',
          title: '<script>alert(1)</script>',
          testDate: '2026-10-20',
          testType: 'chapter',
          marksObtained: 42,
          totalMarks: 100,
        ),
      ],
    );
    final String html = buildPrintableReport(data, generatedOn: '2026-10-23');
    expect(html, isNot(contains('<script>alert(1)</script>')));
    expect(html, contains('&lt;script&gt;alert(1)&lt;/script&gt;'));
    expect(html, contains('42.0 / 100'));
  });
}
