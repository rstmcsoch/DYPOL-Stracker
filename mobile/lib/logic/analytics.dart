import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';
import 'progress.dart';

/// Analytics ported from src/lib/analytics.ts. Empty data is shown as empty, never
/// invented: every helper returns null until real records exist.

/// A percentage is only valid for a whole-number total, half-mark scores and 0…total.
double? validPercentage(double? marks, double? total) {
  if (marks == null || total == null) return null;
  if (!total.isFinite || total <= 0) return null;
  if (total != total.roundToDouble()) return null;
  if (marks < 0 || marks > total) return null;
  if (marks * 2 != (marks * 2).truncateToDouble()) return null;
  return marks / total * 100;
}

double? testPercentage(TestRecord test) => validPercentage(test.marksObtained, test.totalMarks);

double? subjectPercentage(TestSubjectScore score) =>
    validPercentage(score.marksObtained, score.totalMarks);

const List<String> jeeSubjects = <String>['Physics', 'Chemistry', 'Maths'];

class MarksTotal {
  const MarksTotal(this.marks, this.total);
  final double marks;
  final double total;
}

/// A Full Mock's subject rows, or null when they cannot form a complete aggregate.
Map<String, TestSubjectScore>? _fullMockRows(String testId, List<TestSubjectScore> scores) {
  final List<TestSubjectScore> rows =
      scores.where((TestSubjectScore score) => score.testId == testId).toList();
  if (rows.isEmpty) return null;
  final Map<String, TestSubjectScore> bySubject = <String, TestSubjectScore>{};
  for (final TestSubjectScore row in rows) {
    if (bySubject.containsKey(row.subject)) return null;
    bySubject[row.subject] = row;
  }
  final bool legacy = rows.every((TestSubjectScore row) => jeeSubjects.contains(row.subject));
  if (legacy) {
    if (rows.length != jeeSubjects.length) return null;
    for (final String subject in jeeSubjects) {
      if (!bySubject.containsKey(subject)) return null;
    }
  }
  return bySubject;
}

MarksTotal? fullMockAggregate(String testId, List<TestSubjectScore> scores) {
  final Map<String, TestSubjectScore>? rows = _fullMockRows(testId, scores);
  if (rows == null) return null;
  double marks = 0;
  double total = 0;
  for (final TestSubjectScore score in rows.values) {
    if (subjectPercentage(score) == null) return null;
    marks += score.marksObtained ?? 0;
    total += score.totalMarks ?? 0;
  }
  if (total <= 0 || marks > total) return null;
  return MarksTotal(marks, total);
}

/// Overall result for one test: complete Full Mocks aggregate their subject rows.
MarksTotal? overallTestScore(TestRecord test, List<TestSubjectScore> scores) {
  if (test.testType == 'Full Mock') {
    final bool hasRows = scores.any((TestSubjectScore score) => score.testId == test.id);
    if (hasRows) return fullMockAggregate(test.id, scores);
  }
  if (test.marksObtained != null && validPercentage(test.marksObtained, test.totalMarks) != null) {
    return MarksTotal(test.marksObtained!, test.totalMarks!);
  }
  return null;
}

double? overallTestPercentage(TestRecord test, List<TestSubjectScore> scores) {
  final MarksTotal? result = overallTestScore(test, scores);
  return result == null ? null : validPercentage(result.marks, result.total);
}

class MeanResult {
  const MeanResult(this.average, this.count);
  final double? average;
  final int count;
}

MeanResult meanTestPercentage(List<TestRecord> tests, List<TestSubjectScore> scores) {
  final List<double> values = <double>[];
  for (final TestRecord test in tests) {
    final double? value = overallTestPercentage(test, scores);
    if (value != null) values.add(value);
  }
  if (values.isEmpty) return const MeanResult(null, 0);
  final double sum = values.fold<double>(0, (double acc, double item) => acc + item);
  return MeanResult(sum / values.length, values.length);
}

class ChapterPerformance {
  const ChapterPerformance({
    required this.chapter,
    required this.results,
    required this.average,
    required this.latest,
    required this.trend,
    required this.dropping,
    required this.classification,
  });

  final Chapter chapter;
  final List<({TestRecord test, double percentage})> results;
  final double? average;
  final double? latest;
  final String trend;
  final bool dropping;

  /// Weak / Okay / Strong / Untested, using the account's own thresholds.
  final String classification;
}

List<ChapterPerformance> chapterPerformance(AppData data) {
  final Map<String, List<({TestRecord test, double percentage})>> grouped =
      <String, List<({TestRecord test, double percentage})>>{};
  for (final TestRecord test in data.tests) {
    if (test.chapterId == null) continue;
    final double? value = overallTestPercentage(test, data.testSubjectScores);
    if (value == null) continue;
    grouped.putIfAbsent(test.chapterId!, () => <({TestRecord test, double percentage})>[])
      ..add((test: test, percentage: value));
  }
  for (final TestChapterLink link in data.testChapterLinks) {
    final double? value = validPercentage(link.marksObtained, link.totalMarks);
    final TestRecord? test = data.test(link.testId);
    if (value == null || test == null) continue;
    grouped.putIfAbsent(link.chapterId, () => <({TestRecord test, double percentage})>[])
      ..add((test: test, percentage: value));
  }

  final double weak = data.settings.weakThreshold;
  final double strong = data.settings.strongThreshold;
  final double dropping = data.settings.droppingThreshold;

  return <ChapterPerformance>[
    for (final Chapter chapter in data.chapters)
      _performanceFor(chapter, grouped[chapter.id] ?? <({TestRecord test, double percentage})>[], weak, strong, dropping),
  ];
}

ChapterPerformance _performanceFor(
  Chapter chapter,
  List<({TestRecord test, double percentage})> rows,
  double weak,
  double strong,
  double dropping,
) {
  final List<({TestRecord test, double percentage})> results =
      List<({TestRecord test, double percentage})>.from(rows)
        ..sort((({TestRecord test, double percentage}) a, ({TestRecord test, double percentage}) b) =>
            a.test.testDate.compareTo(b.test.testDate));
  if (results.isEmpty) {
    return ChapterPerformance(
      chapter: chapter,
      results: const <({TestRecord test, double percentage})>[],
      average: null,
      latest: null,
      trend: 'none',
      dropping: false,
      classification: 'Untested',
    );
  }
  final double sum = results.fold<double>(0, (double acc, ({TestRecord test, double percentage}) item) => acc + item.percentage);
  final double average = sum / results.length;
  final double latest = results.last.percentage;
  String trend = 'none';
  bool isDropping = false;
  if (results.length >= 2) {
    final double previous = results[results.length - 2].percentage;
    final double delta = latest - previous;
    if (delta > 2) {
      trend = 'up';
    } else if (delta < -2) {
      trend = 'down';
    } else {
      trend = 'steady';
    }
    isDropping = latest < previous - dropping;
  }
  final String classification = average < weak
      ? 'Weak'
      : (average >= strong ? 'Strong' : 'Okay');
  return ChapterPerformance(
    chapter: chapter,
    results: results,
    average: average,
    latest: latest,
    trend: trend,
    dropping: isDropping,
    classification: classification,
  );
}

/// Weak-area list: chapters averaging below the account's weak threshold.
List<ChapterPerformance> weakChapters(AppData data) {
  final List<ChapterPerformance> rows = chapterPerformance(data)
      .where((ChapterPerformance row) => row.classification == 'Weak')
      .toList()
    ..sort((ChapterPerformance a, ChapterPerformance b) => (a.average ?? 0).compareTo(b.average ?? 0));
  return rows;
}

List<ChapterPerformance> untestedChapters(AppData data) => chapterPerformance(data)
    .where((ChapterPerformance row) => row.classification == 'Untested')
    .toList();

/* ------------------------------------------------------------------ */
/* Test trend                                                          */
/* ------------------------------------------------------------------ */

class TrendPoint {
  const TrendPoint(this.date, this.percentage, this.title);
  final String date;
  final double percentage;
  final String title;
}

List<TrendPoint> testTrend(AppData data, {int limit = 12}) {
  final List<({String date, double percentage, String title})> rows =
      <({String date, double percentage, String title})>[];
  for (final TestRecord test in data.tests) {
    final double? value = overallTestPercentage(test, data.testSubjectScores);
    if (value == null) continue;
    rows.add((date: test.testDate, percentage: value, title: test.title));
  }
  rows.sort((({String date, double percentage, String title}) a,
          ({String date, double percentage, String title}) b) =>
      a.date.compareTo(b.date));
  final List<({String date, double percentage, String title})> tail =
      rows.length > limit ? rows.sublist(rows.length - limit) : rows;
  return <TrendPoint>[
    for (final ({String date, double percentage, String title}) row in tail)
      TrendPoint(row.date, row.percentage, row.title),
  ];
}

/* ------------------------------------------------------------------ */
/* Subject signals                                                     */
/* ------------------------------------------------------------------ */

class SubjectSignal {
  const SubjectSignal({
    required this.subject,
    required this.average,
    required this.tests,
    required this.practiceAccuracy,
    required this.practiceAttempts,
    required this.chapters,
    required this.completed,
  });

  final String subject;
  final double? average;
  final int tests;
  final double? practiceAccuracy;
  final int practiceAttempts;
  final int chapters;
  final int completed;
}

List<SubjectSignal> subjectSignals(AppData data) {
  final Map<String, String> chapterSubject = <String, String>{
    for (final Chapter chapter in data.chapters) chapter.id: chapter.subject,
  };
  final List<SubjectSignal> signals = <SubjectSignal>[];
  for (final String subject in data.subjects) {
    final List<TestRecord> tests =
        data.tests.where((TestRecord test) => test.subject == subject).toList();
    final MeanResult mean = meanTestPercentage(tests, data.testSubjectScores);
    int attempted = 0;
    int correct = 0;
    for (final PracticeSession session in data.practiceSessions) {
      if (chapterSubject[session.chapterId] != subject) continue;
      attempted += session.attempted;
      correct += session.correct;
    }
    final List<Chapter> chapters =
        data.chapters.where((Chapter chapter) => chapter.subject == subject).toList();
    signals.add(SubjectSignal(
      subject: subject,
      average: mean.average,
      tests: tests.length,
      practiceAccuracy: attempted > 0 ? correct / attempted * 100 : null,
      practiceAttempts: attempted,
      chapters: chapters.length,
      completed: chapters.where((Chapter chapter) => chapter.isComplete).length,
    ));
  }
  return signals;
}

/* ------------------------------------------------------------------ */
/* Mistake summary                                                     */
/* ------------------------------------------------------------------ */

class MistakeSummary {
  const MistakeSummary({required this.total, required this.byType, required this.pendingRetries});
  final int total;
  final Map<String, int> byType;
  final int pendingRetries;
}

MistakeSummary mistakeSummary(AppData data) {
  final Map<String, int> byType = <String, int>{};
  for (final Mistake mistake in data.mistakes) {
    byType[mistake.mistakeType] = (byType[mistake.mistakeType] ?? 0) + 1;
  }
  return MistakeSummary(
    total: data.mistakes.length,
    byType: byType,
    pendingRetries: data.pendingRetries.length,
  );
}

/// Rule-based study prompts (never an AI claim). Each prompt explains the data behind it.
List<String> studyPrompts(AppData data) {
  final List<String> prompts = <String>[];
  final List<ChapterPerformance> weak = weakChapters(data);
  if (weak.isNotEmpty) {
    prompts.add('${weak.first.chapter.name} averages ${(weak.first.average ?? 0).toStringAsFixed(0)}% '
        'across ${weak.first.results.length} test${weak.first.results.length == 1 ? '' : 's'} — below your '
        '${data.settings.weakThreshold.toStringAsFixed(0)}% weak threshold.');
  }
  final Map<String, PracticeAggregate> practice = practiceByChapter(data);
  for (final MapEntry<String, PracticeAggregate> entry in practice.entries) {
    final PracticeAggregate value = entry.value;
    if (value.attempted >= practiceMinAttemptsForSignal &&
        (value.accuracy ?? 100) < data.settings.weakThreshold) {
      prompts.add('Practice on ${data.chapterName(entry.key)} is at '
          '${(value.accuracy ?? 0).toStringAsFixed(0)}% over ${value.attempted} questions.');
      break;
    }
  }
  final int overdue = data.openRevisions().where((Revision revision) => isPast(revision.dueOn)).length;
  if (overdue > 0) {
    prompts.add('$overdue revision${overdue == 1 ? ' is' : 's are'} overdue. Clear them before starting '
        'anything new.');
  }
  final int retries = data.pendingRetries.length;
  if (retries > 0) {
    prompts.add('$retries mistake${retries == 1 ? '' : 's'} still waiting for a retry.');
  }
  if (prompts.isEmpty && data.tests.isEmpty && data.practiceSessions.isEmpty) {
    prompts.add('No tests or practice logged yet — the notebook only reports what you record.');
  }
  return prompts;
}
