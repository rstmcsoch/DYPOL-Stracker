import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/analytics.dart';

void main() {
  test('scoreSubjectBase folds JEE Advanced paper rows', () {
    expect(scoreSubjectBase('Physics — Paper 2'), 'Physics');
    expect(scoreSubjectBase('Physics'), 'Physics');
  });

  test('empty notebook exports only the header row with a BOM', () {
    final String csv = trendCsv(AppData.empty('u1'));
    expect(csv.startsWith('\ufeff"Date","Overall %"'), isTrue);
    expect(csv.contains('\r\n'), isFalse);
  });

  test('rows are by date, numbers print like the website and blanks stay blank', () {
    final AppData data = AppData.empty('u1').copyWith(
      tests: <TestRecord>[
        TestRecord(id: 't2', userId: 'u1', title: 'B', testDate: '2026-02-01', testType: 'Chapter Test', subject: 'Physics', marksObtained: 20, totalMarks: 30),
        TestRecord(id: 't1', userId: 'u1', title: 'A', testDate: '2026-01-01', testType: 'Chapter Test', subject: 'Physics', marksObtained: 40, totalMarks: 80),
        TestRecord(id: 't3', userId: 'u1', title: 'C', testDate: '2026-03-01', testType: 'Full Mock'),
      ],
      testSubjectScores: <TestSubjectScore>[
        TestSubjectScore(id: 's1', userId: 'u1', testId: 't3', subject: 'Physics', marksObtained: 50, totalMarks: 100),
        TestSubjectScore(id: 's2', userId: 'u1', testId: 't3', subject: 'Chemistry', marksObtained: 25, totalMarks: 100),
        TestSubjectScore(id: 's3', userId: 'u1', testId: 't3', subject: 'Maths', marksObtained: null, totalMarks: 100),
      ],
    );
    final List<String> lines = trendCsv(data).substring(1).split('\r\n');
    final List<String> header = lines.first.split(',');
    expect(header.take(2), <String>['"Date"', '"Overall %"']);
    final int physics = header.indexOf('"Physics %"');
    final int chemistry = header.indexOf('"Chemistry %"');
    final int maths = header.indexOf('"Maths %"');
    expect(physics, greaterThan(1));
    final List<List<String>> rows = <List<String>>[for (final String line in lines.skip(1)) line.split(',')];
    expect(rows.map((List<String> r) => r.first), <String>['"2026-01-01"', '"2026-02-01"', '"2026-03-01"']);
    expect(rows[0][1], '"50"');
    expect(rows[0][physics], '"50"');
    expect(rows[1][1], '"${20 / 30 * 100}"');
    expect(rows[2][physics], '"50"');
    expect(rows[2][chemistry], '"25"');
    expect(rows[2][maths], '""');
  });
}
