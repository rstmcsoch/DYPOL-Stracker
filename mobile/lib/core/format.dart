/// Small shared formatters. Percentages and minutes are the two numbers Stracker
/// shows everywhere, so they are defined once.
String percentLabel(double? value, {int digits = 0, String empty = '—'}) {
  if (value == null || value.isNaN) return empty;
  return '${value.toStringAsFixed(digits)}%';
}

String numberLabel(num? value, {int digits = 0, String empty = '—'}) {
  if (value == null) return empty;
  final double asDouble = value.toDouble();
  if (digits == 0 && asDouble == asDouble.roundToDouble()) return asDouble.round().toString();
  return asDouble.toStringAsFixed(digits);
}

/// 95 -> "1h 35m", 45 -> "45m", 0 -> "0m".
String minutesLabel(num? minutes) {
  final int total = (minutes ?? 0).round();
  if (total <= 0) return '0m';
  final int hours = total ~/ 60;
  final int rest = total % 60;
  if (hours == 0) return '${rest}m';
  if (rest == 0) return '${hours}h';
  return '${hours}h ${rest}m';
}

String hoursLabel(num? minutes) {
  final double hours = (minutes ?? 0) / 60;
  return '${hours.toStringAsFixed(hours >= 10 ? 0 : 1)}h';
}

/// Whole numbers keep no decimal, halves keep one: 42 -> "42", 42.5 -> "42.5".
/// Mirrors `Intl.NumberFormat('en-IN', {maximumFractionDigits: 1})` on the website.
String _scoreDigits(double value) => value == value.truncateToDouble()
    ? value.toStringAsFixed(0)
    : value.toStringAsFixed(1);

/// "42 / 80" style summary used by test rows.
String scoreLabel(double? obtained, double? total) {
  if (obtained == null || total == null) return 'No score';
  return '${_scoreDigits(obtained)} / ${_scoreDigits(total)}';
}

String clampText(String value, int max) =>
    value.length <= max ? value : '${value.substring(0, max - 1)}…';

/// Indefinite article-free pluraliser: plural(2, 'chapter') -> "2 chapters".
String plural(int count, String singular, [String? pluralForm]) =>
    '$count ${count == 1 ? singular : (pluralForm ?? '${singular}s')}';
