import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/date.dart';
import 'package:stracker/core/format.dart';

void main() {
  test('date arithmetic crosses months and years', () {
    expect(addDays('2026-01-31', 1), '2026-02-01');
    expect(addDays('2026-03-01', -1), '2026-02-28');
    expect(addDays('2025-12-31', 1), '2026-01-01');
    expect(daysBetween('2026-01-01', '2026-01-31'), 30);
    expect(daysBetween('2026-01-31', '2026-01-01'), -30);
  });

  test('a week starts on Monday', () {
    // 2026-01-10 is a Saturday.
    expect(startOfWeek('2026-01-10'), '2026-01-05');
    expect(endOfWeek('2026-01-10'), '2026-01-11');
    final List<String> week = dateRange('2026-01-05', '2026-01-11');
    expect(week.length, 7);
    expect(week.first, '2026-01-05');
    expect(week.last, '2026-01-11');
  });

  test('invalid dates fall back instead of throwing', () {
    expect(parseIsoDate('not a date'), isNull);
    expect(parseIsoDate(null), isNull);
    expect(parseIsoOrToday('2026-01-10'), DateTime(2026, 1, 10));
    expect(formatDate(null), isNotEmpty);
  });

  test('number and percentage formatting never shows a fake zero', () {
    expect(percentLabel(null), '—');
    expect(percentLabel(48.4), '48%');
    expect(percentLabel(48.45, digits: 1), '48.5%');
    expect(numberLabel(null), '—');
    expect(numberLabel(2.0), '2');
    expect(scoreLabel(42, 80), '42 / 80');
    expect(minutesLabel(95), contains('1'));
    expect(hoursLabel(120), contains('2'));
    expect(plural(1, 'test'), '1 test');
    expect(plural(3, 'test'), '3 tests');
  });
}
