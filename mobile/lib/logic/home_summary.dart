import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';
import 'exam.dart';

/// Home header, "The Big Day" countdown and "Your rhythm" streak card, ported line for
/// line from src/pages/HomePage.tsx and src/lib/jee/study-time.ts so the phone shows the
/// same numbers as the website.

const Duration _ist = Duration(hours: 5, minutes: 30);

/// `morning` before 12:00 IST, `afternoon` before 17:00, otherwise `evening`.
String greetingPart(DateTime nowUtc) {
  final int hour = nowUtc.toUtc().add(_ist).hour;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/// "Good morning, Riya." — owner_name, then the profile display name, then the website's
/// own fallback.
String homeGreeting(AppData data, DateTime nowUtc) {
  final String owner = data.settings.ownerName;
  final String display = data.profile?.displayName ?? '';
  final String name = owner.isNotEmpty ? owner : (display.isNotEmpty ? display : 'future engineer');
  return 'Good ${greetingPart(nowUtc)}, $name.';
}

const List<String> _monthLong = <String>[
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/// Intl en-IN `{weekday: long, day: numeric, month: long}` in Asia/Kolkata, upper-cased:
/// "SUNDAY, 25 OCTOBER".
String homeDateEyebrow(DateTime nowUtc) {
  final DateTime ist = nowUtc.toUtc().add(_ist);
  return '${weekdayLong[ist.weekday - 1]}, ${ist.day} ${_monthLong[ist.month - 1]}'.toUpperCase();
}

/// en-IN short months (September is "Sept" in en-IN, unlike en-GB).
const List<String> _monthShortIn = <String>[
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
];

/// The website's `prettyDate`: "15 May 2027", or an em dash when unset.
String prettyDate(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final DateTime? date = parseIsoDate(iso);
  if (date == null) return iso;
  return '${date.day} ${_monthShortIn[date.month - 1]} ${date.year}';
}

/// The IST calendar date of a timestamp (src/lib/date.ts `indiaDate`).
String indiaDate(String value) {
  final DateTime? parsed = DateTime.tryParse(value);
  if (parsed == null) return value.length >= 10 ? value.substring(0, 10) : value;
  // Date-only strings parse as local midnight; keep them as written.
  if (value.length <= 10) return isoDate(parsed);
  return isoDate(parsed.toUtc().add(_ist));
}

const int streakMinutes = 15;

/// Days that count toward the streak, exactly the website's `qualifyingDays`: 15+ minutes
/// summed over every recorded session that day, a practice log with questions attempted,
/// a completed revision, or a logged test.
Set<String> qualifyingDays(AppData data) {
  final Map<String, int> minutesByDay = <String, int>{};
  for (final StudySession session in data.sessions) {
    final String day = indiaDate(session.startedAt);
    minutesByDay[day] = (minutesByDay[day] ?? 0) + session.durationMinutes;
  }
  final Set<String> days = <String>{
    for (final MapEntry<String, int> entry in minutesByDay.entries)
      if (entry.value >= streakMinutes) entry.key,
  };
  for (final PracticeSession practice in data.practiceSessions) {
    if (practice.attempted > 0) days.add(practice.practiceDate);
  }
  for (final Revision revision in data.revisions) {
    final String? completed = revision.completedAt;
    if (completed != null && completed.isNotEmpty) days.add(indiaDate(completed));
  }
  for (final TestRecord test in data.tests) {
    days.add(test.testDate);
  }
  return days;
}

class StreakSummary {
  const StreakSummary({
    required this.current,
    required this.longest,
    required this.weeklyConsistency,
    required this.qualifyingToday,
  });

  final int current;
  final int longest;

  /// Qualifying days among the last seven IST days, today included.
  final int weeklyConsistency;
  final bool qualifyingToday;
}

StreakSummary computeStreaks(AppData data, String today) {
  final Set<String> days = qualifyingDays(data);
  final List<String> sorted = days.where((String day) => day.compareTo(today) <= 0).toList()..sort();
  int longest = 0;
  int run = 0;
  String? previous;
  for (final String day in sorted) {
    run = previous != null && daysBetween(previous, day) == 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }
  final String yesterday = addDays(today, -1);
  String cursor = days.contains(today) ? today : (days.contains(yesterday) ? yesterday : '');
  int current = 0;
  while (cursor.isNotEmpty && days.contains(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  int weekly = 0;
  for (int offset = 0; offset < 7; offset += 1) {
    if (days.contains(addDays(today, -offset))) weekly += 1;
  }
  return StreakSummary(
    current: current,
    longest: longest,
    weeklyConsistency: weekly,
    qualifyingToday: days.contains(today),
  );
}

/// One exam line on the Big Day card. [dotOrange] picks the orange (maths) dot, otherwise
/// the blue (physics) one.
class BigDayExam {
  const BigDayExam({required this.label, required this.days, required this.date, required this.dotOrange});

  final String label;
  final int? days;
  final String? date;
  final bool dotOrange;
}

class BigDay {
  const BigDay({
    required this.badge,
    required this.unsetLabel,
    required this.primary,
    required this.secondary,
    required this.completedChapters,
    required this.totalChapters,
  });

  final String badge;

  /// Shown above "Set your date" when there is no primary date.
  final String unsetLabel;
  final BigDayExam? primary;
  final BigDayExam? secondary;
  final int completedChapters;
  final int totalChapters;
}

int? _daysUntil(String? date, String today) => date == null || date.isEmpty ? null : daysBetween(today, date);

BigDay computeBigDay(AppData data, String today) {
  final AppSettings settings = data.settings;
  final bool jee = isJeeSettings(settings);
  final String examTitle = chosenExamTitle(data);
  final int? examDays = _daysUntil(settings.advancedExamDate, today);
  final int? mainDays = _daysUntil(settings.mainExamDate, today);
  final String? boardsDate = jee ? null : trackDate(data, 'boards');

  final BigDayExam? otherPrimary = mainDays != null
      ? BigDayExam(label: examTitle, days: mainDays, date: settings.mainExamDate, dotOrange: false)
      : null;
  final BigDayExam? otherSecondary = settings.boardsAddon
      ? BigDayExam(
          label: 'Class 12 boards',
          days: _daysUntil(boardsDate, today),
          date: boardsDate ?? '',
          dotOrange: true,
        )
      : null;
  final BigDayExam? jeePrimary = examDays != null
      ? BigDayExam(label: 'JEE Advanced', days: examDays, date: settings.advancedExamDate, dotOrange: true)
      : mainDays != null
          ? BigDayExam(label: 'JEE Main', days: mainDays, date: settings.mainExamDate, dotOrange: false)
          : null;
  final BigDayExam jeeSecondary = jeePrimary?.label == 'JEE Main'
      ? BigDayExam(label: 'JEE Advanced', days: examDays, date: settings.advancedExamDate, dotOrange: true)
      : BigDayExam(label: 'JEE Main', days: mainDays, date: settings.mainExamDate, dotOrange: false);

  final int completed =
      data.chapters.where((Chapter chapter) => chapter.status == 'Done' || chapter.status == 'Revised').length;
  return BigDay(
    badge: jee ? 'JEE ${settings.examYear ?? 2027}' : examTitle,
    unsetLabel: jee ? 'JEE Main & Advanced' : examTitle,
    primary: jee ? jeePrimary : otherPrimary,
    secondary: jee ? jeeSecondary : otherSecondary,
    completedChapters: completed,
    totalChapters: data.chapters.length,
  );
}

/// The website's `countdownLabel(days)` (src/lib/jee/exam.ts).
String countdownForDays(int? days) {
  if (days == null) return 'Date not set';
  if (days < 0) return 'Exam date has passed';
  if (days == 0) return 'Today';
  return '$days day${days == 1 ? '' : 's'} left';
}

class ExamModeState {
  const ExamModeState({required this.active, required this.reason, required this.label, required this.daysLeft});

  final bool active;
  final String reason;
  final String label;
  final int? daysLeft;
}

/// src/lib/jee/exam.ts `currentExamMode`, with the reason text the Home banner shows.
ExamModeState examModeState(AppData data, String today) {
  final String track = effectiveTrack(data.settings);
  final int? days = _daysUntil(trackDate(data, track), today);
  final String label = trackLabels(data)[track] ?? chosenExamTitle(data);
  final String setting = data.settings.examMode;
  if (setting == 'off') {
    return ExamModeState(active: false, reason: 'Exam Mode is switched off in Settings.', label: label, daysLeft: days);
  }
  if (setting == 'on') {
    return ExamModeState(
        active: true, reason: 'Exam Mode is switched on manually in Settings.', label: label, daysLeft: days);
  }
  if (days == null) {
    return ExamModeState(
      active: false,
      reason: 'Add the exam date in Settings to enable automatic Exam Mode.',
      label: label,
      daysLeft: null,
    );
  }
  if (days >= 0 && days <= examModeWindowDays) {
    return ExamModeState(
      active: true,
      reason: '$label is ${countdownForDays(days).toLowerCase()} away — inside the final $examModeWindowDays days.',
      label: label,
      daysLeft: days,
    );
  }
  return ExamModeState(
    active: false,
    reason: days > examModeWindowDays
        ? 'Exam Mode starts $examModeWindowDays days before $label.'
        : 'The active exam date has passed.',
    label: label,
    daysLeft: days,
  );
}
