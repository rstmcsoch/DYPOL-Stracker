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

/// Whether any saved test covers the chapter, directly or through a chapter link, even
/// when its score was left blank — the same evidence the web "Tested" stage uses.
bool chapterHasTestEvidence(AppData data, String chapterId) =>
    data.tests.any((TestRecord test) => test.chapterId == chapterId) ||
    data.testChapterLinks.any((TestChapterLink link) => link.chapterId == chapterId);

/// Chapters with no saved test at all, so saving any test for a chapter removes it.
List<ChapterPerformance> untestedChapters(AppData data) => chapterPerformance(data)
    .where((ChapterPerformance row) =>
        row.classification == 'Untested' && !chapterHasTestEvidence(data, row.chapter.id))
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

/// The website's subject base: JEE Advanced "Physics — Paper 1/2" rows share one subject.
String scoreSubjectBase(String subject) =>
    subject.replaceFirst(RegExp(r'\s+—\s+Paper\s+[12]$', caseSensitive: false), '');

/// Mirrors the website's subjectsFor: exam subjects, then any subject used by chapters,
/// tests or subject score rows, in first-seen order.
List<String> trendSubjects(AppData data) {
  final List<String> list = <String>[...data.subjects];
  void add(String? subject) {
    if (subject != null && subject.isNotEmpty && !list.contains(subject)) list.add(subject);
  }

  for (final TestRecord test in data.tests) {
    add(test.subject);
  }
  for (final TestSubjectScore score in data.testSubjectScores) {
    add(score.subject);
  }
  return list;
}

/// JavaScript's String(number), so the CSV matches the website's byte for byte
/// (50 rather than 50.0).
String _jsNumber(double value) =>
    value == value.truncateToDouble() && value.abs() < 1e15 ? value.toInt().toString() : value.toString();

/// The website's "Export trend CSV" (Analytics header): one row per test by date, the
/// overall % and each subject's %. Blank cells are left blank, never filled in.
String trendCsv(AppData data) {
  final List<String> subjects = trendSubjects(data);
  final List<({int index, TestRecord test})> ordered = <({int index, TestRecord test})>[
    for (int i = 0; i < data.tests.length; i++) (index: i, test: data.tests[i]),
  ]..sort((({int index, TestRecord test}) a, ({int index, TestRecord test}) b) {
      final int byDate = a.test.testDate.compareTo(b.test.testDate);
      return byDate != 0 ? byDate : a.index.compareTo(b.index);
    });

  final List<List<String>> rows = <List<String>>[
    <String>['Date', 'Overall %', for (final String subject in subjects) '$subject %'],
  ];
  for (final ({int index, TestRecord test}) entry in ordered) {
    final TestRecord test = entry.test;
    final Map<String, double?> bySubject = <String, double?>{};
    if (test.testType == 'Full Mock') {
      final Set<String> seen = <String>{};
      final Map<String, ({double marks, double total, bool incomplete})> grouped =
          <String, ({double marks, double total, bool incomplete})>{};
      for (final TestSubjectScore score in data.testSubjectScores) {
        if (score.testId != test.id || !seen.add(score.subject)) continue;
        final String base = scoreSubjectBase(score.subject);
        final ({double marks, double total, bool incomplete}) current =
            grouped[base] ?? (marks: 0, total: 0, incomplete: false);
        grouped[base] = (
          marks: current.marks + (score.marksObtained ?? 0),
          total: current.total + (score.totalMarks ?? 0),
          incomplete: current.incomplete || score.marksObtained == null || score.totalMarks == null,
        );
      }
      grouped.forEach((String subject, ({double marks, double total, bool incomplete}) value) {
        bySubject[subject] = value.incomplete ? null : validPercentage(value.marks, value.total);
      });
    } else if (test.subject != null && test.subject!.isNotEmpty) {
      bySubject[test.subject!] = testPercentage(test);
    }
    final double? overall = overallTestPercentage(test, data.testSubjectScores);
    rows.add(<String>[
      test.testDate,
      overall == null ? '' : _jsNumber(overall),
      for (final String subject in subjects)
        bySubject[subject] == null ? '' : _jsNumber(bySubject[subject]!),
    ]);
  }
  final String csv = rows
      .map((List<String> row) => row.map((String value) => '"${value.replaceAll('"', '""')}"').join(','))
      .join('\r\n');
  return '\ufeff$csv';
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

/// The website's "Export test CSV" (lib/backup.ts `testsToCsv`): one row per test in the
/// optional date range, oldest first, with recorded marks only. Cells that a spreadsheet
/// would read as a formula are prefixed with an apostrophe.
String testsToCsv(AppData data, {String from = '', String to = ''}) {
  String cell(Object? value) {
    String text = value == null ? '' : (value is double ? _jsNumber(value) : value.toString());
    if (RegExp(r'^[=+@-]').hasMatch(text)) text = "'$text";
    return '"${text.replaceAll('"', '""')}"';
  }

  const List<String> headers = <String>[
    'Date', 'Test', 'Type', 'Subject', 'Chapter', 'Marks', 'Total', 'Percentage', 'Correct', 'Wrong', //
    'Skipped', 'Negative marks', 'Time minutes', 'Notes', 'Physics marks', 'Physics total', 'Chemistry marks',
    'Chemistry total', 'Maths marks', 'Maths total',
  ];
  final List<TestRecord> tests = data.tests
      .where((TestRecord test) =>
          (from.isEmpty || test.testDate.compareTo(from) >= 0) && (to.isEmpty || test.testDate.compareTo(to) <= 0))
      .toList()
    ..sort((TestRecord a, TestRecord b) => a.testDate.compareTo(b.testDate));
  final List<String> rows = <String>[headers.map(cell).join(',')];
  for (final TestRecord test in tests) {
    final List<TestSubjectScore> scores =
        data.testSubjectScores.where((TestSubjectScore score) => score.testId == test.id).toList();
    final String subject = test.testType == 'Full Mock' ? 'All subjects' : (test.subject ?? '');
    final String chapter = data.chapter(test.chapterId)?.name ?? '';
    final MarksTotal? overall = overallTestScore(test, data.testSubjectScores);
    final double? score = overallTestPercentage(test, data.testSubjectScores);
    final bool useRaw = overall == null && (test.testType != 'Full Mock' || scores.isEmpty);
    final Object? marks = overall?.marks ?? (useRaw ? test.marksObtained : null);
    final Object? total = overall?.total ?? (useRaw ? test.totalMarks : null);
    Object? scoreFor(String name, bool marksField) {
      for (final TestSubjectScore row in scores) {
        if (row.subject == name) return marksField ? row.marksObtained : row.totalMarks;
      }
      return null;
    }

    rows.add(<Object?>[
      test.testDate, test.title, test.testType, subject, chapter, marks, total, //
      score == null ? '' : '${score.toStringAsFixed(1)}%',
      test.correct, test.wrong, test.skipped, test.negativeMarks, test.timeMinutes, test.notes,
      scoreFor('Physics', true), scoreFor('Physics', false), scoreFor('Chemistry', true),
      scoreFor('Chemistry', false), scoreFor('Maths', true), scoreFor('Maths', false),
    ].map(cell).join(','));
  }
  return '\ufeff${rows.join('\r\n')}';
}

/* ------------------------------------------------------------------ */
/* Website analytics page metrics (src/lib/analytics.ts,              */
/* src/lib/study-aggregation.ts)                                      */

bool _validCounts(TestRecord test, bool includeSkipped) {
  final List<int?> values = includeSkipped
      ? <int?>[test.correct, test.wrong, test.skipped]
      : <int?>[test.correct, test.wrong];
  return values.every((int? value) => value != null && value >= 0);
}

/// `getAccuracy`: correct / (correct + wrong) over tests with both counts.
({int correct, int attempted, double? rate}) attemptAccuracy(AppData data) {
  final Iterable<TestRecord> tests = data.tests.where((TestRecord t) => _validCounts(t, false));
  final int correct = tests.fold<int>(0, (int s, TestRecord t) => s + t.correct!);
  final int attempted = tests.fold<int>(0, (int s, TestRecord t) => s + t.correct! + t.wrong!);
  return (correct: correct, attempted: attempted, rate: attempted > 0 ? correct / attempted * 100 : null);
}

/// `getAttemptRate`: attempted / (attempted + skipped) over tests with all three counts.
({int attempted, int total, double? rate}) attemptRate(AppData data) {
  final Iterable<TestRecord> tests = data.tests.where((TestRecord t) => _validCounts(t, true));
  final int attempted = tests.fold<int>(0, (int s, TestRecord t) => s + t.correct! + t.wrong!);
  final int total = tests.fold<int>(0, (int s, TestRecord t) => s + t.correct! + t.wrong! + t.skipped!);
  return (attempted: attempted, total: total, rate: total > 0 ? attempted / total * 100 : null);
}

/// `getOverallTestTotal`: a whole-number positive total, from complete Full Mock rows or the test.
double? overallTestTotal(TestRecord test, List<TestSubjectScore> scores) {
  bool whole(double? v) => v != null && v.isFinite && v == v.roundToDouble() && v > 0;
  if (test.testType == 'Full Mock') {
    final Map<String, TestSubjectScore>? rows = _fullMockRows(test.id, scores);
    if (rows != null) {
      final List<double?> totals = rows.values.map((TestSubjectScore r) => r.totalMarks).toList();
      if (totals.every(whole)) return totals.fold<double>(0, (double s, double? v) => s + v!);
    }
    if (scores.any((TestSubjectScore s) => s.testId == test.id)) return null;
  }
  return whole(test.totalMarks) ? test.totalMarks : null;
}

/// `getNegativeMarkImpact`.
({double totalNegativeMarks, double? percentage, int testsIncluded}) negativeMarkImpact(AppData data) {
  final List<TestRecord> recorded = data.tests
      .where((TestRecord t) => t.negativeMarks != null && t.negativeMarks!.isFinite && t.negativeMarks! >= 0)
      .toList();
  final double totalNegative = recorded.fold<double>(0, (double s, TestRecord t) => s + t.negativeMarks!);
  double comparable = 0;
  double totalMarks = 0;
  int included = 0;
  for (final TestRecord test in recorded) {
    final double? total = overallTestTotal(test, data.testSubjectScores);
    if (total == null) continue;
    comparable += test.negativeMarks!;
    totalMarks += total;
    included += 1;
  }
  return (
    totalNegativeMarks: totalNegative,
    percentage: totalMarks > 0 ? comparable / totalMarks * 100 : null,
    testsIncluded: included,
  );
}

/// `getMistakeCounts`: the five notebook types in the website's order.
List<({String type, int count})> mistakeCounts(AppData data) => <({String type, int count})>[
      for (final String type in const <String>['Concept', 'Silly', 'Calculation', 'Time', 'Guess'])
        (type: type, count: data.mistakes.where((Mistake m) => m.mistakeType == type).length),
    ];

int _sessionMinutesBetween(AppData data, String start, String end) {
  int sum = 0;
  for (final StudySession session in data.sessions) {
    final String date = indiaDateOf(session.startedAt);
    if (date.compareTo(start) >= 0 && date.compareTo(end) <= 0) sum += session.durationMinutes;
  }
  return sum;
}

/// The IST calendar date of a timestamp; a plain yyyy-MM-dd passes through.
String indiaDateOf(String value) {
  final DateTime? parsed = DateTime.tryParse(value);
  if (parsed == null) return value.length >= 10 ? value.substring(0, 10) : value;
  if (!value.contains('T') && value.length <= 10) return value.substring(0, 10);
  return isoDate(parsed.toUtc().add(const Duration(hours: 5, minutes: 30)));
}

const List<String> _monthShort = <String>[
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', //
];

DateTime _day(String iso) => DateTime.utc(int.parse(iso.substring(0, 4)), int.parse(iso.substring(5, 7)),
    int.parse(iso.substring(8, 10)));

String _isoUtc(DateTime d) => isoDate(DateTime(d.year, d.month, d.day));

/// `makeStudyBars`: 14 days, 8 Monday-start weeks or 6 months, hours to one decimal.
List<({String date, String label, double hours})> studyBars(AppData data, String view, String asOf) {
  double hours(int minutes) => (minutes / 60 * 10).round() / 10;
  final DateTime today = _day(asOf);
  final List<({String date, String label, double hours})> bars = <({String date, String label, double hours})>[];
  if (view == 'day') {
    for (int index = 13; index >= 0; index -= 1) {
      final DateTime d = today.subtract(Duration(days: index));
      final String date = _isoUtc(d);
      bars.add((date: date, label: '${d.day} ${_monthShort[d.month - 1]}', hours: hours(_sessionMinutesBetween(data, date, date))));
    }
    return bars;
  }
  if (view == 'week') {
    final DateTime monday = today.subtract(Duration(days: today.weekday - 1));
    for (int index = 7; index >= 0; index -= 1) {
      final DateTime start = monday.subtract(Duration(days: 7 * index));
      final String startIso = _isoUtc(start);
      final String fullEnd = _isoUtc(start.add(const Duration(days: 6)));
      final String end = fullEnd.compareTo(asOf) < 0 ? fullEnd : asOf;
      bars.add((
        date: startIso,
        label: '${start.day} ${_monthShort[start.month - 1]}',
        hours: hours(_sessionMinutesBetween(data, startIso, end)),
      ));
    }
    return bars;
  }
  for (int index = 5; index >= 0; index -= 1) {
    final DateTime monthStart = DateTime.utc(today.year, today.month - index, 1);
    final String start = _isoUtc(monthStart);
    final String fullEnd = _isoUtc(DateTime.utc(monthStart.year, monthStart.month + 1, 0));
    final String end = fullEnd.compareTo(asOf) < 0 ? fullEnd : asOf;
    bars.add((
      date: start,
      label: '${_monthShort[monthStart.month - 1]} ${(monthStart.year % 100).toString().padLeft(2, '0')}',
      hours: hours(_sessionMinutesBetween(data, start, end)),
    ));
  }
  return bars;
}

/// `makeStudyHeatmap`: 16 Monday-start weeks; levels against the daily goal.
({List<({String date, int minutes, String level, bool future})> cells, int daysLogged}) studyHeatmap(
  AppData data,
  String asOf,
) {
  final DateTime today = _day(asOf);
  final DateTime start = today.subtract(Duration(days: today.weekday - 1 + 15 * 7));
  final int goal = data.settings.dailyStudyGoalMinutes < 1 ? 1 : data.settings.dailyStudyGoalMinutes;
  final List<({String date, int minutes, String level, bool future})> cells =
      <({String date, int minutes, String level, bool future})>[];
  for (int index = 0; index < 16 * 7; index += 1) {
    final String date = _isoUtc(start.add(Duration(days: index)));
    final bool future = date.compareTo(asOf) > 0;
    final int minutes = future ? 0 : _sessionMinutesBetween(data, date, date);
    final double ratio = minutes / goal;
    final String level = minutes == 0
        ? 'none'
        : ratio < 0.3
            ? 'low'
            : ratio < 0.7
                ? 'medium'
                : ratio < 1
                    ? 'high'
                    : 'goal';
    cells.add((date: date, minutes: minutes, level: level, future: future));
  }
  return (
    cells: cells,
    daysLogged: cells.where((({String date, int minutes, String level, bool future}) c) => !c.future && c.minutes > 0).length,
  );
}

/// The website's mock-target comparison: the latest Full Mock with a usable score.
({double score, double gap, String state})? mockTargetComparison(AppData data) {
  final List<TestRecord> mocks = data.tests.where((TestRecord t) => t.testType == 'Full Mock').toList()
    ..sort((TestRecord a, TestRecord b) => b.testDate.compareTo(a.testDate));
  for (final TestRecord test in mocks) {
    final MarksTotal? aggregate = overallTestScore(test, data.testSubjectScores);
    if (aggregate == null) continue;
    final double target = data.settings.targetScore;
    final double gap = target - aggregate.marks;
    final double tolerance = target * 0.05 > 1 ? target * 0.05 : 1;
    return (score: aggregate.marks, gap: gap, state: gap <= 0 ? 'above' : gap <= tolerance ? 'near' : 'below');
  }
  return null;
}

/// `getSubjectPerformance`: per subject, the mean of subject-test percentages and complete
/// Full Mock subject results (JEE Advanced paper rows combine into one result per test).
List<({String subject, double? average, int count})> subjectPerformance(AppData data) {
  final List<String> subjects = <String>[];
  void add(String? subject) {
    if (subject != null && subject.isNotEmpty && !subjects.contains(subject)) subjects.add(subject);
  }

  examSubjectNames(data).forEach(add);
  for (final Chapter chapter in data.chapters) {
    add(chapter.subject);
  }
  trendSubjects(data).forEach(add);
  final Map<String, List<double>> bySubject = <String, List<double>>{for (final String s in subjects) s: <double>[]};
  for (final TestRecord test in data.tests) {
    if (test.testType == 'Full Mock') {
      final Set<String> seen = <String>{};
      final Map<String, List<TestSubjectScore>> grouped = <String, List<TestSubjectScore>>{};
      for (final TestSubjectScore score in data.testSubjectScores) {
        if (score.testId != test.id || !seen.add(score.subject)) continue;
        grouped.putIfAbsent(scoreSubjectBase(score.subject), () => <TestSubjectScore>[]).add(score);
      }
      grouped.forEach((String subject, List<TestSubjectScore> rows) {
        if (rows.any((TestSubjectScore r) => r.marksObtained == null || r.totalMarks == null)) return;
        final double marks = rows.fold<double>(0, (double s, TestSubjectScore r) => s + r.marksObtained!);
        final double total = rows.fold<double>(0, (double s, TestSubjectScore r) => s + r.totalMarks!);
        final double? value = validPercentage(marks, total);
        if (value != null) bySubject[subject]?.add(value);
      });
    } else if (test.subject != null) {
      final double? value = testPercentage(test);
      if (value != null) bySubject[test.subject!]?.add(value);
    }
  }
  return <({String subject, double? average, int count})>[
    for (final String subject in subjects)
      (
        subject: subject,
        average: bySubject[subject]!.isEmpty
            ? null
            : bySubject[subject]!.fold<double>(0, (double a, double b) => a + b) / bySubject[subject]!.length,
        count: bySubject[subject]!.length,
      ),
  ];
}

/// Website `getMarksTrend`: one row per test from [since] (inclusive, null = all), by date,
/// with the overall % and each subject's % (null where nothing comparable was recorded).
List<({String date, double? overall, Map<String, double?> bySubject})> marksTrend(AppData data, {String? since}) {
  final List<TestRecord> tests = data.tests
      .where((TestRecord t) => since == null || t.testDate.compareTo(since) >= 0)
      .toList()
    ..sort((TestRecord a, TestRecord b) => a.testDate.compareTo(b.testDate));
  return <({String date, double? overall, Map<String, double?> bySubject})>[
    for (final TestRecord test in tests)
      (
        date: test.testDate,
        overall: overallTestPercentage(test, data.testSubjectScores),
        bySubject: _trendSubjects(data, test),
      ),
  ];
}

Map<String, double?> _trendSubjects(AppData data, TestRecord test) {
  final Map<String, double?> bySubject = <String, double?>{};
  if (test.testType == 'Full Mock') {
    final Set<String> seen = <String>{};
    final Map<String, ({double marks, double total, bool incomplete})> grouped =
        <String, ({double marks, double total, bool incomplete})>{};
    for (final TestSubjectScore score in data.testSubjectScores) {
      if (score.testId != test.id || !seen.add(score.subject)) continue;
      final String base = scoreSubjectBase(score.subject);
      final ({double marks, double total, bool incomplete}) current =
          grouped[base] ?? (marks: 0, total: 0, incomplete: false);
      grouped[base] = (
        marks: current.marks + (score.marksObtained ?? 0),
        total: current.total + (score.totalMarks ?? 0),
        incomplete: current.incomplete || score.marksObtained == null || score.totalMarks == null,
      );
    }
    grouped.forEach((String subject, ({double marks, double total, bool incomplete}) value) {
      bySubject[subject] = value.incomplete ? null : validPercentage(value.marks, value.total);
    });
  } else if (test.subject != null && test.subject!.isNotEmpty) {
    bySubject[test.subject!] = testPercentage(test);
  }
  return bySubject;
}
