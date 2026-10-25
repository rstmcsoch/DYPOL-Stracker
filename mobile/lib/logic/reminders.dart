import '../core/date.dart';
import '../core/format.dart';
import '../data/app_data.dart';
import '../data/models.dart';
import 'focus.dart';
import 'progress.dart';
import 'recommend.dart';
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

/// The website's reminder kinds (src/types `REMINDER_KINDS`), in its order. Only these are
/// written to `app_settings.reminder_types`; the website drops anything else when it reads.
const List<String> reminderKinds = <String>['revision', 'backlog', 'practice', 'pyq', 'mock', 'plan'];

const Map<String, String> reminderLabel = <String, String>{
  'revision': 'Due revision',
  'backlog': 'Backlog',
  'practice': 'Practice',
  'pyq': 'PYQs',
  'mock': 'Mock',
  'plan': 'Study plan',
};

class ReminderItem {
  const ReminderItem({required this.kind, required this.title, required this.body});

  final String kind;
  final String title;
  final String body;
}

/// src/lib/jee/reminders.ts `computeReminders`: the reminders that apply right now. Only
/// enabled kinds are returned, and each is backed by a real count.
List<ReminderItem> computeReminders(AppData data, String today) {
  final AppSettings settings = data.settings;
  if (!settings.remindersEnabled) return const <ReminderItem>[];
  final Set<String> enabled = settings.reminderTypes.toSet();
  final List<ReminderItem> items = <ReminderItem>[];

  if (enabled.contains('revision')) {
    final int due =
        data.revisions.where((Revision item) => item.completedAt == null && item.dueOn.compareTo(today) <= 0).length;
    if (due > 0) {
      items.add(ReminderItem(
        kind: 'revision',
        title: 'Revision is due',
        body: '$due revision${due == 1 ? '' : 's'} due or overdue in Stracker.',
      ));
    }
  }
  if (enabled.contains('backlog')) {
    final int due = data.backlogItems
        .where((BacklogItem item) =>
            isBacklogAwake(item, today) && item.dueOn != null && item.dueOn!.compareTo(today) <= 0)
        .length;
    if (due > 0) {
      items.add(ReminderItem(
        kind: 'backlog',
        title: 'Backlog is due',
        body: '$due backlog item${due == 1 ? '' : 's'} due today or earlier.',
      ));
    }
  }
  if (enabled.contains('practice') &&
      !data.practiceSessions.any((PracticeSession item) => item.practiceDate == today)) {
    items.add(const ReminderItem(
      kind: 'practice',
      title: 'No practice logged today',
      body: 'A short DPP block keeps your accuracy honest.',
    ));
  }
  if (enabled.contains('pyq')) {
    int pending = 0;
    for (final Chapter chapter in data.chapters) {
      if (chapter.status == 'Not Started') continue;
      pending += pyqCompletion(data.pyqRecords, chapter.id, 'Main', settings).pendingYears.length;
    }
    if (pending > 0) {
      items.add(ReminderItem(
        kind: 'pyq',
        title: 'PYQs are waiting',
        body: '$pending PYQ year${pending == 1 ? '' : 's'} pending on chapters you have started.',
      ));
    }
  }
  if (enabled.contains('mock')) {
    final List<TestRecord> tests = <TestRecord>[...data.tests]
      ..sort((TestRecord a, TestRecord b) => b.testDate.compareTo(a.testDate));
    final int? days = tests.isEmpty ? null : daysBetween(tests.first.testDate, today);
    if (days == null || days >= 14) {
      items.add(ReminderItem(
        kind: 'mock',
        title: 'Time for a mock check',
        body: days == null ? 'No test is logged yet.' : 'Your last test was $days days ago.',
      ));
    }
  }
  if (enabled.contains('plan') && !data.tasks.any((DailyTask task) => task.taskDate == today)) {
    items.add(const ReminderItem(
      kind: 'plan',
      title: 'Plan today',
      body: 'Add one task so today has a clear start.',
    ));
  }
  return items;
}
