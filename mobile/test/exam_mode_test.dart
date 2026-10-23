import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/exam.dart';

AppData data({
  String mode = 'auto',
  String? mainDate,
  String track = 'main1',
}) {
  return AppData(
    userId: 'u1',
    settings: AppSettings.defaults('u1').copyWith(
      examMode: mode,
      mainExamDate: mainDate,
      activeTrack: track,
    ),
  );
}

void main() {
  test('auto mode needs a real date inside the 30-day window', () {
    expect(currentExamMode(data(), '2026-01-01'), isFalse);
    expect(currentExamMode(data(mainDate: '2026-01-25'), '2026-01-01'), isTrue);
    expect(currentExamMode(data(mainDate: '2026-01-31'), '2026-01-01'), isTrue);
    expect(currentExamMode(data(mainDate: '2026-02-01'), '2026-01-01'), isFalse);
    expect(currentExamMode(data(mainDate: '2025-12-25'), '2026-01-01'), isFalse);
    expect(currentExamMode(data(mainDate: '2026-01-25'), '2026-01-26'), isFalse);
  });

  test('the manual switch wins over the date', () {
    expect(currentExamMode(data(mode: 'on'), '2020-01-01'), isTrue);
    expect(currentExamMode(data(mode: 'off', mainDate: '2026-01-02'), '2026-01-01'), isFalse);
  });

  test('an unknown track falls back to the first one', () {
    expect(effectiveTrack(AppSettings.defaults('u1').copyWith(activeTrack: 'nope')), 'main1');
    expect(effectiveTrack(AppSettings.defaults('u1').copyWith(activeTrack: 'advanced')), 'advanced');
  });

  test('a non-JEE exam only offers the tracks it supports', () {
    final AppSettings other = AppSettings.defaults('u1').copyWith(examId: 'bitsat');
    expect(availableTracks(other), <String>['main1']);
    expect(availableTracks(other.copyWith(boardsAddon: true)), <String>['main1', 'boards']);
  });

  test('the exam label names the track and the countdown', () {
    final String label = examModeLabel(data(mainDate: '2026-01-20'), '2026-01-01');
    expect(label, startsWith('On · JEE Main — Session 1'));
    expect(examModeLabel(data(), '2026-01-01'), 'Off');
  });
}
