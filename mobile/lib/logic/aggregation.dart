import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';

/// Study-time, consistency and weekly-report maths (src/lib/study-aggregation.ts and
/// src/lib/jee/weekly-report.ts).
///
/// Streak rule, stated in the UI as well: a day counts when it has
///  * 15+ minutes of recorded study, or
///  * a practice log with questions attempted, or
///  * a completed revision, or
///  * a logged test.
/// Opening pages never counts.
const int streakMinMinutes = 15;

class DayActivity {
  const DayActivity({
    required this.date,
    this.minutes = 0,
    this.practiceAttempted = 0,
    this.completedRevisions = 0,
    this.tests = 0,
  });

  final String date;
  final int minutes;
  final int practiceAttempted;
  final int completedRevisions;
  final int tests;

  bool get counts => minutes >= streakMinMinutes ||
      practiceAttempted > 0 ||
      completedRevisions > 0 ||
      tests > 0;
}

/// One entry per calendar day that has any recorded evidence.
Map<String, DayActivity> dailyActivity(AppData data) {
  final Map<String, DayActivity> days = <String, DayActivity>{};

  DayActivity current(String dateKey) => days[dateKey] ?? DayActivity(date: dateKey);
  void put(DayActivity value) => days[value.date] = value;

  for (final StudySession session in data.sessions) {
    if (session.mode == 'Short Break' || session.mode == 'Long Break') continue;
    if (session.completionState != 'completed') continue;
    final String key = session.startedAt.isEmpty
        ? todayIso()
        : isoDate(DateTime.parse(session.startedAt).toUtc().add(const Duration(hours: 5, minutes: 30)));
    final DayActivity day = current(key);
    put(DayActivity(
      date: key,
      minutes: day.minutes + session.durationMinutes,
      practiceAttempted: day.practiceAttempted,
      completedRevisions: day.completedRevisions,
      tests: day.tests,
    ));
  }

  for (final PracticeSession session in data.practiceSessions) {
    final DayActivity day = current(session.practiceDate);
    put(DayActivity(
      date: day.date,
      minutes: day.minutes,
      practiceAttempted: day.practiceAttempted + session.attempted,
      completedRevisions: day.completedRevisions,
      tests: day.tests,
    ));
  }

  for (final Revision revision in data.revisions) {
    final String? completed = revision.completedAt;
    if (completed == null) continue;
    final String key = isoDate(DateTime.parse(completed).toUtc().add(const Duration(hours: 5, minutes: 30)));
    final DayActivity day = current(key);
    put(DayActivity(
      date: day.date,
      minutes: day.minutes,
      practiceAttempted: day.practiceAttempted,
      completedRevisions: day.completedRevisions + 1,
      tests: day.tests,
    ));
  }

  for (final TestRecord test in data.tests) {
    final DayActivity day = current(test.testDate);
    put(DayActivity(
      date: day.date,
      minutes: day.minutes,
      practiceAttempted: day.practiceAttempted,
      completedRevisions: day.completedRevisions,
      tests: day.tests + 1,
    ));
  }

  return days;
}

class StudyTotals {
  const StudyTotals({
    required this.todayMinutes,
    required this.weekMinutes,
    required this.totalMinutes,
    required this.streak,
    required this.byActivity,
  });

  final int todayMinutes;
  final int weekMinutes;
  final int totalMinutes;
  final int streak;
  final Map<String, int> byActivity;
}

StudyTotals studyTotals(AppData data, {String? today}) {
  final String day = today ?? todayIso();
  final Map<String, DayActivity> activity = dailyActivity(data);

  int totalMinutes = 0;
  final Map<String, int> byActivity = <String, int>{
    for (final String name in <String>['Lecture', 'Practice', 'Revision', 'Mock/Test', 'PYQ practice']) name: 0,
  };
  for (final StudySession session in data.sessions) {
    if (session.mode == 'Short Break' || session.mode == 'Long Break') continue;
    if (session.completionState != 'completed') continue;
    totalMinutes += session.durationMinutes;
    byActivity[session.activity] = (byActivity[session.activity] ?? 0) + session.durationMinutes;
  }
  // Practice minutes are mirrored into study time under the Practice activity by the
  // web client; when a session row already carries them we do not double count.
  for (final PracticeSession session in data.practiceSessions) {
    final int minutes = session.timeMinutes ?? 0;
    if (minutes == 0) continue;
    final bool mirrored = data.sessions.any((StudySession row) =>
        row.activity == 'Practice' &&
        row.chapterId == session.chapterId &&
        row.durationMinutes == minutes &&
        row.startedAt.startsWith(session.practiceDate));
    if (mirrored) continue;
    totalMinutes += minutes;
    byActivity['Practice'] = (byActivity['Practice'] ?? 0) + minutes;
  }

  final String weekStart = startOfWeek(day);
  final String weekEnd = endOfWeek(day);
  int weekMinutes = 0;
  for (final DayActivity entry in activity.values) {
    final bool inWeek = entry.date.compareTo(weekStart) >= 0 && entry.date.compareTo(weekEnd) <= 0;
    if (inWeek) weekMinutes += entry.minutes;
  }

  int streak = 0;
  String cursor = day;
  // A streak survives today until the day is over: start counting from today when it
  // already has evidence, otherwise from yesterday.
  if (!(activity[cursor]?.counts ?? false)) cursor = addDays(day, -1);
  int guard = 0;
  while ((activity[cursor]?.counts ?? false) && guard < 400) {
    streak += 1;
    cursor = addDays(cursor, -1);
    guard += 1;
  }

  return StudyTotals(
    todayMinutes: activity[day]?.minutes ?? 0,
    weekMinutes: weekMinutes,
    totalMinutes: totalMinutes,
    streak: streak,
    byActivity: byActivity,
  );
}

/// Last 28 days of minute totals, oldest first, for the consistency strip.
List<({String date, int minutes})> consistencyStrip(AppData data, {String? today, int days = 28}) {
  final Map<String, DayActivity> activity = dailyActivity(data);
  final String end = today ?? todayIso();
  return <({String date, int minutes})>[
    for (final String date in dateRange(addDays(end, -(days - 1)), end))
      (date: date, minutes: activity[date]?.minutes ?? 0),
  ];
}

class WeeklyReport {
  const WeeklyReport({
    required this.weekStart,
    required this.weekEnd,
    required this.thisWeek,
    required this.lastWeek,
    required this.hasComparison,
    required this.lines,
  });

  final String weekStart;
  final String weekEnd;

  /// Metric label -> value for the current week.
  final Map<String, int> thisWeek;
  final Map<String, int> lastWeek;

  /// True only when both weeks contain real data, so the app never compares a week
  /// against an empty one.
  final bool hasComparison;
  final List<String> lines;
}

WeeklyReport weeklyReport(AppData data, {String? today}) {
  final String day = today ?? todayIso();
  final String weekStart = startOfWeek(day);
  final String lastStart = addDays(weekStart, -7);
  final String lastEnd = addDays(weekStart, -1);

  Map<String, int> metricsFor(String from, String to) {
    int minutes = 0;
    int sessions = 0;
    int revisions = 0;
    int tests = 0;
    for (final StudySession session in data.sessions) {
      if (session.mode == 'Short Break' || session.mode == 'Long Break') continue;
      if (session.completionState != 'completed') continue;
      final String key = session.startedAt.isEmpty
          ? day
          : isoDate(DateTime.parse(session.startedAt).toUtc().add(const Duration(hours: 5, minutes: 30)));
      if (key.compareTo(from) >= 0 && key.compareTo(to) <= 0) {
        minutes += session.durationMinutes;
        sessions += 1;
      }
    }
    for (final Revision revision in data.revisions) {
      final String? completed = revision.completedAt;
      if (completed == null) continue;
      final String key = isoDate(DateTime.parse(completed).toUtc().add(const Duration(hours: 5, minutes: 30)));
      if (key.compareTo(from) >= 0 && key.compareTo(to) <= 0) revisions += 1;
    }
    for (final TestRecord test in data.tests) {
      if (test.testDate.compareTo(from) >= 0 && test.testDate.compareTo(to) <= 0) tests += 1;
    }
    int practiceQuestions = 0;
    for (final PracticeSession session in data.practiceSessions) {
      if (session.practiceDate.compareTo(from) >= 0 && session.practiceDate.compareTo(to) <= 0) {
        practiceQuestions += session.attempted;
      }
    }
    return <String, int>{
      'Study minutes': minutes,
      'Focus sessions': sessions,
      'Revisions': revisions,
      'Tests': tests,
      'Practice questions': practiceQuestions,
    };
  }

  final Map<String, int> thisWeek = metricsFor(weekStart, addDays(weekStart, 6));
  final Map<String, int> lastWeek = metricsFor(lastStart, lastEnd);
  final bool thisHasData = thisWeek.values.any((int value) => value > 0);
  final bool lastHasData = lastWeek.values.any((int value) => value > 0);

  final List<String> lines = <String>[];
  if (!thisHasData && !lastHasData) {
    lines.add('No study recorded in the last two weeks yet.');
  } else if (!lastHasData) {
    lines.add('This is the first week with recorded study — there is nothing to compare yet.');
  } else {
    for (final String metric in thisWeek.keys) {
      final int now = thisWeek[metric] ?? 0;
      final int before = lastWeek[metric] ?? 0;
      if (now == 0 && before == 0) continue;
      final int delta = now - before;
      final String direction = delta > 0 ? 'up' : (delta < 0 ? 'down' : 'level');
      lines.add('$metric: $now ($direction ${delta.abs()} vs last week)');
    }
  }

  return WeeklyReport(
    weekStart: weekStart,
    weekEnd: addDays(weekStart, 6),
    thisWeek: thisWeek,
    lastWeek: lastWeek,
    hasComparison: thisHasData && lastHasData,
    lines: lines,
  );
}
