import '../core/date.dart';
import '../core/format.dart';
import '../data/app_data.dart';
import '../data/models.dart';
import 'focus.dart';
import 'revision.dart';

/// Reminders inside the app.
///
/// The website sends browser notifications; the app has no notification package in its
/// dependency set, so it surfaces the same reminders as an in-app banner when the app is
/// open after the reminder time. Nothing is scheduled in the background — that is
/// reported as a limitation rather than pretended.
bool remindersActive(AppSettings settings) => settings.remindersEnabled;

/// Minutes since midnight for the stored reminder time (`HH:MM`), or null when invalid.
int? reminderMinutes(AppSettings settings) {
  final List<String> parts = settings.reminderTime.split(':');
  if (parts.length != 2) return null;
  final int? hour = int.tryParse(parts[0]);
  final int? minute = int.tryParse(parts[1]);
  if (hour == null || minute == null) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

bool isAfterReminderTime(AppSettings settings, {DateTime? now}) {
  final int? target = reminderMinutes(settings);
  if (target == null) return false;
  final DateTime current = now ?? nowIst();
  return current.hour * 60 + current.minute >= target;
}

/// The lines the dashboard shows. Each type is only included when the student enabled it.
List<String> reminderLines(AppData data, {String? today, DateTime? now}) {
  final AppSettings settings = data.settings;
  if (!remindersActive(settings)) return const <String>[];
  final String day = today ?? todayIso();
  final List<String> lines = <String>[];
  if (settings.reminderTypes.contains('revision')) {
    final RevisionBuckets buckets = revisionBuckets(data, today: day);
    final int due = buckets.overdue.length + buckets.today.length;
    if (due > 0) {
      lines.add('$due revision${due == 1 ? '' : 's'} due'
          '${buckets.overdue.isEmpty ? ' today' : ', ${buckets.overdue.length} overdue'}');
    }
  }
  if (settings.reminderTypes.contains('backlog')) {
    final int due = data.backlogItems
        .where((BacklogItem item) =>
            !item.isDone &&
            item.status == 'active' &&
            (item.dueOn == null || item.dueOn!.compareTo(day) <= 0))
        .length;
    if (due > 0) lines.add('$due backlog item${due == 1 ? '' : 's'} waiting');
  }
  if (settings.reminderTypes.contains('tests')) {
    final int testsToday = data.tests.where((TestRecord test) => test.testDate == day).length;
    if (testsToday == 0) lines.add('No test logged today');
  }
  if (settings.reminderTypes.contains('goal')) {
    final int minutes = data.sessions
        .where((StudySession session) =>
            session.startedAt.startsWith(day) && countsAsStudyTime(session))
        .fold<int>(0, (int sum, StudySession session) => sum + session.durationMinutes);
    if (minutes < settings.dailyStudyGoalMinutes) {
      lines.add('${minutesLabel(settings.dailyStudyGoalMinutes - minutes)} short of today’s goal');
    }
  }
  return lines;
}

/// One-line summary for the settings screen.
String reminderSummary(AppSettings settings) => settings.remindersEnabled
    ? 'On · ${settings.reminderTime} · ${settings.reminderTypes.join(', ')}'
    : 'Off';
