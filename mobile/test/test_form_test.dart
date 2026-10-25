import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/marking.dart';
import 'package:stracker/logic/test_form.dart';

TestSaveResult save(TestFormInput input, {TestRecord? existing, List<TestSubjectScore> scores = const <TestSubjectScore>[]}) =>
    buildTestSave(
      input: input,
      testId: 't1',
      userId: 'u1',
      chapters: const <Chapter>[Chapter(id: 'c1', userId: 'u1', subject: 'Physics', name: 'Optics')],
      existingScores: scores,
      existingLinks: const <TestChapterLink>[],
      existing: existing,
      now: '2026-10-25T00:00:00Z',
    );

void main() {
  group('test form (web testFormSchema + saveTest)', () {
    test('total questions must fit correct + wrong + skipped', () {
      final TestSaveResult r = save(const TestFormInput(
          title: 'A', date: '2026-10-25', type: 'Chapter Test', correct: '20', wrong: '10', skipped: '25', questions: '50'));
      expect(r.errors['questions'], 'Correct + wrong + skipped (55) can’t be more than the 50 questions in this test.');
      expect(save(const TestFormInput(title: 'A', date: '2026-10-25', type: 'Chapter Test', questions: '0')).errors['questions'],
          'Total questions must be at least 1.');
    });

    test('score rules, negative marks in quarter steps and title required', () {
      final TestSaveResult r = save(const TestFormInput(
          title: ' ', date: '2026-10-25', type: 'Subject Test', marks: '50', negative: '1.1'));
      expect(r.errors['title'], 'Test title is required.');
      expect(r.errors['total'], 'Add a positive whole-number total to record a score.');
      expect(r.errors['negative_marks'], isNotNull);
      expect(save(const TestFormInput(title: 'A', date: '2026-10-25', type: 'Subject Test', marks: '90', total: '80'))
          .errors['marks'], 'Marks obtained cannot exceed total marks.');
    });

    test('chapter must belong to the subject and a valid save writes a chapter link', () {
      expect(
        save(const TestFormInput(title: 'A', date: '2026-10-25', type: 'Chapter Test', subject: 'Maths', chapterId: 'c1'))
            .errors['chapter_id'],
        'Choose a chapter that belongs to the selected subject.',
      );
      final TestSaveResult ok = save(const TestFormInput(
          title: 'A', date: '2026-10-25', type: 'Chapter Test', chapterId: 'c1', marks: '40.5', total: '60', negative: '2.25'));
      expect(ok.ok, isTrue);
      expect(ok.test!.subject, 'Physics');
      expect(ok.test!.negativeMarks, 2.25);
      expect(ok.link!.chapterId, 'c1');
      expect(ok.link!.marksObtained, 40.5);
    });

    test('a complete Full Mock sums its subject rows; partial rows keep no overall score', () {
      final TestSaveResult full = save(const TestFormInput(
        title: 'Mock', date: '2026-10-25', type: 'Full Mock', marks: '1', total: '2', chapterId: 'c1',
        mockScores: <String, ({String marks, String total})>{
          'Physics': (marks: '70', total: '100'),
          'Chemistry': (marks: '60.5', total: '100'),
          'Maths': (marks: '50', total: '100'),
        },
      ));
      expect(full.ok, isTrue);
      expect(full.test!.marksObtained, 180.5);
      expect(full.test!.totalMarks, 300);
      expect(full.test!.subject, isNull);
      expect(full.test!.chapterId, isNull);
      expect(full.link, isNull);
      final TestSaveResult partial = save(const TestFormInput(
        title: 'Mock', date: '2026-10-25', type: 'Full Mock',
        mockScores: <String, ({String marks, String total})>{
          'Physics': (marks: '70', total: '100'),
          'Chemistry': (marks: '', total: '100'),
        },
      ));
      expect(partial.test!.marksObtained, isNull);
      expect(partial.scores.length, 2);
      final TestSaveResult bad = save(const TestFormInput(
        title: 'Mock', date: '2026-10-25', type: 'Full Mock',
        mockScores: <String, ({String marks, String total})>{'Physics': (marks: '70', total: '')},
      ));
      expect(bad.errors['Physics.total'], 'Add a positive whole-number subject total for this score.');
    });
  });

  group('marking defaults (web marking.ts)', () {
    test('JEE built-in pre-fills Main, Advanced paper 1 and both papers', () {
      final MarkingScheme? scheme = markingSchemeFor(AppData.empty('u1'));
      const List<String> pcm = <String>['Physics', 'Chemistry', 'Maths'];
      expect(fullMockDefaults(scheme, pcm), <String, String>{'Physics': '100', 'Chemistry': '100', 'Maths': '100'});
      expect(fullMockDefaults(scheme, pcm, 'advanced-paper-1').keys.first, 'Physics — Paper 1');
      expect(fullMockDefaults(scheme, pcm, 'advanced-both').length, 6);
      expect(defaultTotalFor(scheme, 'Chapter Test', null), '180');
      expect(defaultTotalFor(scheme, 'Subject Test', 'Physics'), '60');
    });

    test('catalog scheme wins and is validated', () {
      final AppData data = AppData.empty('u1').copyWith(
        settings: AppData.empty('u1').settings.copyWith(examId: 'neet-ug'),
        examCatalog: const <ExamCatalogEntry>[
          ExamCatalogEntry(id: 'neet-ug', name: 'NEET', category: 'Medical', markingScheme: <String, dynamic>{
            'full': <String, dynamic>{'total': 720, 'perSubject': <String, dynamic>{'Physics': 180, 'Biology': 180}},
            'other': <String, dynamic>{'total': 360, 'perSubject': <String, dynamic>{'Physics': 90}},
            'source': 'NTA',
          }),
        ],
      );
      final MarkingScheme? scheme = markingSchemeFor(data);
      expect(scheme!.source, 'NTA');
      expect(fullMockDefaults(scheme, const <String>['Botany', 'Physics']), <String, String>{'Botany': '90', 'Physics': '180'});
      expect(normalizeMarkingScheme(<String, dynamic>{'full': 1}), isNull);
    });

    test('saved JEE mocks infer their paper pattern', () {
      TestSubjectScore s(String subject, double total) =>
          TestSubjectScore(id: subject, userId: 'u1', testId: 't', subject: subject, totalMarks: total);
      expect(inferJeePattern('Full Mock', <TestSubjectScore>[s('Physics — Paper 1', 60)]), 'advanced-both');
      expect(inferJeePattern('Full Mock', <TestSubjectScore>[s('Physics', 60), s('Maths', 60)]), 'advanced-paper-1');
      expect(inferJeePattern('Full Mock', <TestSubjectScore>[s('Physics', 100)]), 'main');
    });
  });
}
