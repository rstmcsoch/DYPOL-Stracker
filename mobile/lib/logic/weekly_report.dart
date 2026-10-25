import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';
import 'analytics.dart';
import 'progress.dart';

/// Port of the website's `lib/jee/weekly-report.ts` ("Your week" on Analytics).
/// Comparisons appear only when both weeks hold real data for the same subject.

class ActivityMinutes {
  const ActivityMinutes(this.byActivity, this.total);
  final Map<String, int> byActivity;
  final int total;
  int of(String activity) => byActivity[activity] ?? 0;
}

ActivityMinutes studyMinutesByActivity(AppData data, String from, String to) {
  final Map<String, int> totals = <String, int>{
    'Lecture': 0,
    'Practice': 0,
    'Revision': 0,
    'Mock/Test': 0,
    'PYQ practice': 0,
  };
  int total = 0;
  for (final StudySession session in data.sessions) {
    final String day = indiaDateOf(session.startedAt);
    if (day.compareTo(from) < 0 || day.compareTo(to) > 0) continue;
    final String activity = session.activity.isEmpty ? 'Practice' : session.activity;
    totals[activity] = (totals[activity] ?? 0) + session.durationMinutes;
    total += session.durationMinutes;
  }
  return ActivityMinutes(totals, total);
}

({String start, String end}) weekRange(String today) {
  final DateTime day = parseIsoDate(today)!;
  final DateTime monday = day.subtract(Duration(days: day.weekday - DateTime.monday));
  return (start: isoDate(monday), end: today);
}

({String start, String end}) previousWeekRange(String today) {
  final DateTime start = parseIsoDate(weekRange(today).start)!;
  final DateTime prevEnd = start.subtract(const Duration(days: 1));
  return (start: isoDate(prevEnd.subtract(const Duration(days: 6))), end: isoDate(prevEnd));
}

/// Website `subjectsFor`: exam subjects, then any used by chapters, tests or score rows.
List<String> subjectsFor(AppData data) {
  final List<String> list = <String>[...data.subjects];
  void add(String? subject) {
    if (subject != null && subject.isNotEmpty && !list.contains(subject)) list.add(subject);
  }

  for (final Chapter chapter in data.chapters) {
    add(chapter.subject);
  }
  for (final TestRecord test in data.tests) {
    add(test.subject);
  }
  for (final TestSubjectScore score in data.testSubjectScores) {
    add(score.subject);
  }
  return list;
}

typedef SubjectSignalValue = ({String subject, double value, int samples});

bool _inRange(String day, String from, String to) => day.compareTo(from) >= 0 && day.compareTo(to) <= 0;

/// Subject performance inside a date range, pooled from subject-level test percentages
/// and practice accuracy on that subject's chapters. Null when the range has nothing.
Map<String, SubjectSignalValue?> weeklySubjectSignals(AppData data, String from, String to) {
  final List<String> subjects = subjectsFor(data);
  final Map<String, List<double>> values = <String, List<double>>{for (final String s in subjects) s: <double>[]};
  for (final TestRecord test in data.tests) {
    if (!_inRange(test.testDate, from, to)) continue;
    if (test.testType == 'Full Mock') {
      for (final TestSubjectScore score in data.testSubjectScores.where((TestSubjectScore r) => r.testId == test.id)) {
        final double? value = subjectPercentage(score);
        if (value != null) values[score.subject]?.add(value);
      }
    } else if (test.subject != null && test.subject!.isNotEmpty) {
      final double? value = testPercentage(test);
      if (value != null) values[test.subject!]?.add(value);
    }
  }
  final Map<String, String> chapterSubject = <String, String>{for (final Chapter c in data.chapters) c.id: c.subject};
  for (final String subject in subjects) {
    final PracticeAggregate aggregate = aggregatePractice(data.practiceSessions
        .where((PracticeSession p) => _inRange(p.practiceDate, from, to) && chapterSubject[p.chapterId] == subject)
        .toList());
    if (aggregate.accuracy != null && aggregate.attempted > 0) values[subject]?.add(aggregate.accuracy!);
  }
  return <String, SubjectSignalValue?>{
    for (final String subject in subjects)
      subject: values[subject]!.isEmpty
          ? null
          : (
              subject: subject,
              value: values[subject]!.reduce((double a, double b) => a + b) / values[subject]!.length,
              samples: values[subject]!.length,
            ),
  };
}

class WeeklyReport {
  const WeeklyReport({
    required this.start,
    required this.end,
    required this.activity,
    required this.testsLogged,
    required this.questionsAttempted,
    required this.practiceAccuracy,
    required this.activeDays,
    required this.strongestSubject,
    required this.weakestArea,
    required this.comparisons,
    required this.historyNote,
    required this.actionable,
  });

  final String start;
  final String end;
  final ActivityMinutes activity;
  int get studiedMinutes => activity.total;
  final int testsLogged;
  final int questionsAttempted;
  final double? practiceAccuracy;
  final int activeDays;
  final ({String subject, double value})? strongestSubject;
  final ({String name, double value, String basis})? weakestArea;
  final List<String> comparisons;
  final String historyNote;
  final String actionable;
}

WeeklyReport buildWeeklyReport(AppData data, String today) {
  final ({String start, String end}) range = weekRange(today);
  final ({String start, String end}) previous = previousWeekRange(today);
  final ActivityMinutes activity = studyMinutesByActivity(data, range.start, range.end);
  final PracticeAggregate practice = aggregatePractice(
      data.practiceSessions.where((PracticeSession p) => _inRange(p.practiceDate, range.start, range.end)).toList());
  final List<TestRecord> tests =
      data.tests.where((TestRecord t) => _inRange(t.testDate, range.start, range.end)).toList();
  final int activeDays = <String>{
    ...data.sessions
        .map((StudySession s) => indiaDateOf(s.startedAt))
        .where((String d) => _inRange(d, range.start, range.end)),
    ...data.practiceSessions
        .where((PracticeSession p) => p.attempted > 0 && _inRange(p.practiceDate, range.start, range.end))
        .map((PracticeSession p) => p.practiceDate),
    ...tests.map((TestRecord t) => t.testDate),
  }.length;

  final Map<String, SubjectSignalValue?> current = weeklySubjectSignals(data, range.start, range.end);
  final Map<String, SubjectSignalValue?> prior = weeklySubjectSignals(data, previous.start, previous.end);
  final List<SubjectSignalValue> ranked = current.values.whereType<SubjectSignalValue>().toList()
    ..sort((SubjectSignalValue a, SubjectSignalValue b) => b.value.compareTo(a.value));
  final ({String subject, double value})? strongest =
      ranked.isEmpty ? null : (subject: ranked.first.subject, value: ranked.first.value);

  final List<({Chapter chapter, PracticeAggregate agg})> chapterPractice = <({Chapter chapter, PracticeAggregate agg})>[
    for (final Chapter chapter in data.chapters)
      (
        chapter: chapter,
        agg: aggregatePractice(data.practiceSessions
            .where((PracticeSession p) => p.chapterId == chapter.id && _inRange(p.practiceDate, range.start, range.end))
            .toList()),
      ),
  ].where((({Chapter chapter, PracticeAggregate agg}) r) => r.agg.attempted >= 5 && r.agg.accuracy != null).toList()
    ..sort((({Chapter chapter, PracticeAggregate agg}) a, ({Chapter chapter, PracticeAggregate agg}) b) =>
        (a.agg.accuracy ?? 0).compareTo(b.agg.accuracy ?? 0));

  ({String name, double value, String basis})? weakest;
  if (chapterPractice.isNotEmpty) {
    final ({Chapter chapter, PracticeAggregate agg}) first = chapterPractice.first;
    weakest = (
      name: first.chapter.name,
      value: first.agg.accuracy ?? 0,
      basis: 'practice accuracy on ${first.agg.attempted} questions',
    );
  } else {
    final List<ChapterPerformance> testBased = chapterPerformance(data)
        .where((ChapterPerformance c) =>
            c.average != null &&
            c.results
                .any((({TestRecord test, double percentage}) r) => _inRange(r.test.testDate, range.start, range.end)))
        .toList()
      ..sort((ChapterPerformance a, ChapterPerformance b) => (a.average ?? 0).compareTo(b.average ?? 0));
    if (testBased.isNotEmpty) {
      weakest =
          (name: testBased.first.chapter.name, value: testBased.first.average ?? 0, basis: 'average of recent tests');
    }
  }

  final List<String> comparisons = <String>[];
  for (final String subject in current.keys) {
    final SubjectSignalValue? now = current[subject];
    final SubjectSignalValue? before = prior[subject];
    if (now != null && before != null) {
      final int delta = jsRound(now.value - before.value);
      if (delta.abs() >= 3) {
        comparisons.add('$subject performance ${delta < 0 ? 'dropped' : 'rose'} ${delta.abs()} '
            'point${delta.abs() == 1 ? '' : 's'} compared with the previous week.');
      }
    }
  }
  final bool priorHasHistory = prior.values.any((SubjectSignalValue? v) => v != null) ||
      data.sessions.any((StudySession s) => _inRange(indiaDateOf(s.startedAt), previous.start, previous.end));
  final String historyNote = comparisons.isNotEmpty
      ? 'Comparisons use subjects with data in both weeks.'
      : priorHasHistory
          ? 'Not enough overlapping subject data between the two weeks to compare subjects yet.'
          : 'Not enough history to compare with the previous week yet. Comparisons start once you have data in both weeks.';
  final String actionable = comparisons.isNotEmpty
      ? comparisons.first
      : weakest != null
          ? 'Start the next block with ${weakest.name}: ${weakest.basis} is ${jsRound(weakest.value)}%.'
          : 'Log a practice block or test this week to get a specific action.';

  return WeeklyReport(
    start: range.start,
    end: range.end,
    activity: activity,
    testsLogged: tests.length,
    questionsAttempted: practice.attempted,
    practiceAccuracy: practice.accuracy,
    activeDays: activeDays,
    strongestSubject: strongest,
    weakestArea: weakest,
    comparisons: comparisons,
    historyNote: historyNote,
    actionable: actionable,
  );
}

/// JavaScript Math.round (halves round up, also for negatives).
int jsRound(double value) => (value + 0.5).floor();
