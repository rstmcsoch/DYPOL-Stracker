import '../core/validators.dart';
import '../data/models.dart';

/// Save rules for the Log-a-test form, ported from src/pages/TestsPage.tsx (saveTest) and
/// src/lib/test-validation.ts. Field errors are keyed like the website: 'title', 'marks',
/// 'total', 'questions', 'correct', 'wrong', 'skipped', 'negative_marks', 'time_minutes',
/// 'notes', 'chapter_id', `row.marks`, `row.total` and '_form'.

const String fullMockScopeHint =
    'Full Mock records marks separately for each subject. Subject and chapter selection do not apply.';

class TestFormInput {
  const TestFormInput({
    required this.title,
    required this.date,
    required this.type,
    this.subject,
    this.chapterId,
    this.marks = '',
    this.total = '',
    this.correct = '',
    this.wrong = '',
    this.skipped = '',
    this.questions = '',
    this.negative = '',
    this.time = '',
    this.notes = '',
    this.mockScores = const <String, ({String marks, String total})>{},
  });

  final String title;
  final String date;
  final String type;
  final String? subject;
  final String? chapterId;
  final String marks;
  final String total;
  final String correct;
  final String wrong;
  final String skipped;
  final String questions;
  final String negative;
  final String time;
  final String notes;
  final Map<String, ({String marks, String total})> mockScores;
}

class TestSaveResult {
  const TestSaveResult.invalid(this.errors)
      : test = null,
        scores = const <TestSubjectScore>[],
        link = null;
  const TestSaveResult.ok(this.test, this.scores, this.link) : errors = const <String, String>{};

  final Map<String, String> errors;
  final TestRecord? test;
  final List<TestSubjectScore> scores;
  final TestChapterLink? link;
  bool get ok => errors.isEmpty;
}

double? _number(String value) => value.trim().isEmpty ? null : double.tryParse(value.trim());

String? _count(String value, String label) => Validators.intInRange(value, label: label);

TestSaveResult buildTestSave({
  required TestFormInput input,
  required String testId,
  required String userId,
  required List<Chapter> chapters,
  required List<TestSubjectScore> existingScores,
  required List<TestChapterLink> existingLinks,
  TestRecord? existing,
  String now = '',
}) {
  final Map<String, String> errors = <String, String>{};
  final bool fullMock = input.type == 'Full Mock';
  final String title = input.title.trim();
  if (title.isEmpty) {
    errors['title'] = 'Test title is required.';
  } else if (title.length > 160) {
    errors['title'] = 'Test titles can be at most 160 characters.';
  }
  if (Validators.date(input.date) != null) errors['test_date'] = 'Choose a valid date.';
  if (!fullMock) {
    final String? marksError = Validators.marksObtained(input.marks);
    if (marksError != null) errors['marks'] = marksError;
    final String? totalError = Validators.totalMarks(input.total);
    if (totalError != null) errors['total'] = totalError;
  }
  for (final (String key, String value, String label) in <(String, String, String)>[
    ('correct', input.correct, 'Correct'),
    ('wrong', input.wrong, 'Wrong'),
    ('skipped', input.skipped, 'Skipped'),
    ('time_minutes', input.time, 'Time taken'),
  ]) {
    final String? problem = _count(value, label);
    if (problem != null) errors[key] = problem;
  }
  final String q = input.questions.trim();
  if (q.isNotEmpty) {
    final int? parsed = int.tryParse(q);
    if (parsed == null) {
      errors['questions'] = 'Total questions must be a whole number.';
    } else if (parsed < 1) {
      errors['questions'] = 'Total questions must be at least 1.';
    } else if (parsed > 100000) {
      errors['questions'] = 'Total questions can be at most 100,000.';
    }
  }
  final String? negativeError = Validators.negativeMarks(input.negative);
  if (negativeError != null) errors['negative_marks'] = negativeError;
  if (input.notes.trim().length > 10000) errors['notes'] = 'Notes can be at most 10,000 characters.';

  final int? correct = int.tryParse(input.correct.trim());
  final int? wrong = int.tryParse(input.wrong.trim());
  final int? skipped = int.tryParse(input.skipped.trim());
  final int? questions = int.tryParse(q);
  if (!errors.containsKey('questions')) {
    final String? countProblem = Validators.questionCounts(correct, wrong, skipped, questions);
    if (countProblem != null) errors['questions'] = countProblem;
  }
  final double? marks = fullMock ? null : _number(input.marks);
  final double? total = fullMock ? null : _number(input.total);
  if (!errors.containsKey('marks') && !errors.containsKey('total')) {
    if (marks != null && total == null) errors['total'] = 'Add a positive whole-number total to record a score.';
    if (marks != null && total != null && marks > total) errors['marks'] = 'Marks obtained cannot exceed total marks.';
  }

  Chapter? chapter;
  if (!fullMock && input.chapterId != null) {
    for (final Chapter c in chapters) {
      if (c.id == input.chapterId) chapter = c;
    }
    if (chapter == null || (input.subject != null && chapter.subject != input.subject)) {
      errors['chapter_id'] = 'Choose a chapter that belongs to the selected subject.';
    }
  }

  final List<TestSubjectScore> scores = <TestSubjectScore>[];
  if (fullMock) {
    input.mockScores.forEach((String row, ({String marks, String total}) part) {
      final String? m = Validators.marksObtained(part.marks);
      final String? t = Validators.totalMarks(part.total);
      if (m != null) errors['$row.marks'] = m;
      if (t != null) errors['$row.total'] = t;
      if (m != null || t != null) return;
      final double? rowMarks = _number(part.marks);
      final double? rowTotal = _number(part.total);
      if (rowMarks != null && rowTotal == null) {
        errors['$row.total'] = 'Add a positive whole-number subject total for this score.';
        return;
      }
      if (rowMarks != null && rowTotal != null && rowMarks > rowTotal) {
        errors['$row.marks'] = 'Subject marks cannot exceed that subject’s total.';
        return;
      }
      if (rowMarks == null && rowTotal == null) return;
      TestSubjectScore? old;
      for (final TestSubjectScore s in existingScores) {
        if (s.subject == row) old = s;
      }
      scores.add(TestSubjectScore(
        id: old?.id ?? newId(),
        userId: userId,
        testId: testId,
        subject: row,
        marksObtained: rowMarks,
        totalMarks: rowTotal,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      ));
    });
  }
  if (errors.isNotEmpty) return TestSaveResult.invalid(errors);

  final bool completeMock = fullMock &&
      input.mockScores.isNotEmpty &&
      input.mockScores.keys.every((String row) =>
          scores.any((TestSubjectScore s) => s.subject == row && s.marksObtained != null && s.totalMarks != null));
  final bool retainLegacy = fullMock &&
      existing?.testType == 'Full Mock' &&
      existingScores.isEmpty &&
      (existing?.marksObtained != null || existing?.totalMarks != null);
  double? mockMarks;
  double? mockTotal;
  if (completeMock) {
    mockMarks = scores.fold<double>(0, (double sum, TestSubjectScore s) => sum + (s.marksObtained ?? 0));
    mockTotal = scores.fold<double>(0, (double sum, TestSubjectScore s) => sum + (s.totalMarks ?? 0));
    if (mockMarks > mockTotal || mockMarks > Validators.maxMarksObtained || mockTotal > Validators.maxTotalMarks) {
      return const TestSaveResult.invalid(<String, String>{
        '_form': 'The combined Full Mock result is outside the supported total-mark range. Check the subject totals.',
      });
    }
  }

  final TestRecord test = TestRecord(
    id: testId,
    userId: userId,
    title: title,
    testDate: input.date,
    testType: input.type,
    subject: fullMock ? null : (input.subject ?? chapter?.subject),
    chapterId: fullMock ? null : input.chapterId,
    marksObtained: completeMock ? mockMarks : (retainLegacy ? existing?.marksObtained : marks),
    totalMarks: completeMock ? mockTotal : (retainLegacy ? existing?.totalMarks : total),
    correct: correct,
    wrong: wrong,
    skipped: skipped,
    totalQuestions: questions,
    negativeMarks: _number(input.negative),
    timeMinutes: int.tryParse(input.time.trim()),
    notes: input.notes.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  );
  TestChapterLink? link;
  if (test.chapterId != null) {
    TestChapterLink? match;
    for (final TestChapterLink l in existingLinks) {
      if (l.chapterId == test.chapterId) match = l;
    }
    link = TestChapterLink(
      id: match?.id ?? newId(),
      userId: userId,
      testId: testId,
      chapterId: test.chapterId!,
      marksObtained: test.marksObtained,
      totalMarks: test.totalMarks,
      createdAt: match?.createdAt ?? now,
      updatedAt: now,
    );
  }
  return TestSaveResult.ok(test, scores, link);
}
