/// Date helpers. Stracker's "today" is India time (the same rule the website uses in
/// src/lib/date.ts), so a student near midnight IST never loses a day of streaks.

const Duration _istOffset = Duration(hours: 5, minutes: 30);

/// Current calendar date in IST as `yyyy-MM-dd`.
String todayIso() => isoDate(DateTime.now().toUtc().add(_istOffset));

/// Current instant in IST.
DateTime nowIst() => DateTime.now().toUtc().add(_istOffset);

String two(int value) => value.toString().padLeft(2, '0');

String isoDate(DateTime date) => '${date.year}-${two(date.month)}-${two(date.day)}';

DateTime? parseIsoDate(String? value) {
  if (value == null || value.trim().isEmpty) return null;
  try {
    return DateTime.parse(value.length > 10 ? value.substring(0, 10) : value);
  } catch (_) {
    return null;
  }
}

DateTime parseIsoOrToday(String? value) => parseIsoDate(value) ?? DateTime.now();

String addDays(String iso, int days) {
  final DateTime base = parseIsoOrToday(iso);
  return isoDate(DateTime(base.year, base.month, base.day).add(Duration(days: days)));
}

/// Calendar-day difference `b - a` (negative when `b` is before `a`).
int daysBetween(String a, String b) {
  final DateTime first = parseIsoOrToday(a);
  final DateTime second = parseIsoOrToday(b);
  return DateTime(second.year, second.month, second.day)
      .difference(DateTime(first.year, first.month, first.day))
      .inDays;
}

int daysUntil(String iso) => daysBetween(todayIso(), iso);

bool isToday(String? iso) => (iso ?? '').length >= 10 && iso!.substring(0, 10) == todayIso();

bool isPast(String iso) => daysBetween(todayIso(), iso) < 0;

/// Monday-based week start (the planner and weekly report both use it).
String startOfWeek(String iso) {
  final DateTime date = parseIsoOrToday(iso);
  return isoDate(date.subtract(Duration(days: date.weekday - 1)));
}

String endOfWeek(String iso) => addDays(startOfWeek(iso), 6);

const List<String> monthShort = <String>[
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const List<String> weekdayShort = <String>['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const List<String> weekdayLong = <String>[
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

/// "23 Oct 2026"
String formatDate(String? iso) {
  final DateTime? date = parseIsoDate(iso);
  if (date == null) return '—';
  return '${date.day} ${monthShort[date.month - 1]} ${date.year}';
}

/// "Fri, 23 Oct"
String formatDayMonth(String? iso) {
  final DateTime? date = parseIsoDate(iso);
  if (date == null) return '—';
  return '${weekdayShort[date.weekday - 1]}, ${date.day} ${monthShort[date.month - 1]}';
}

/// "23 Oct 2026, 14:05" for timestamps (UTC stored, IST shown).
String formatDateTime(String? value) {
  if (value == null || value.isEmpty) return '—';
  try {
    final DateTime utc = DateTime.parse(value).toUtc().add(_istOffset);
    return '${formatDate(isoDate(utc))}, ${two(utc.hour)}:${two(utc.minute)}';
  } catch (_) {
    return '—';
  }
}

/// Friendly distance: "Today", "Tomorrow", "in 5 days", "3 days overdue".
String dueLabel(String? iso) {
  if (iso == null || iso.isEmpty) return 'No date';
  final int delta = daysBetween(todayIso(), iso);
  if (delta == 0) return 'Today';
  if (delta == 1) return 'Tomorrow';
  if (delta == -1) return 'Yesterday';
  if (delta < -1) return '${-delta} days overdue';
  return 'in $delta days';
}

String countdownLabel(String? iso) {
  if (iso == null || iso.isEmpty) return 'Set a date';
  final int delta = daysBetween(todayIso(), iso);
  if (delta == 0) return 'Today';
  if (delta < 0) return '${-delta} days ago';
  return '$delta days left';
}

/// All dates between [start] and [end] inclusive (used by the study-time heat strip).
List<String> dateRange(String start, String end) {
  final List<String> dates = <String>[];
  String cursor = start;
  int guard = 0;
  while (daysBetween(cursor, end) >= 0 && guard < 800) {
    dates.add(cursor);
    cursor = addDays(cursor, 1);
    guard++;
  }
  return dates;
}
