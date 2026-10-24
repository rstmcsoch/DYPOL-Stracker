import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/aggregation.dart';
import 'package:stracker/logic/focus.dart';

void main() {
  final DateTime t0 = DateTime.utc(2026, 10, 24, 4, 0);
  const String blockId = '11111111-1111-4111-8111-111111111111';
  String id() => blockId;

  test('elapsed time survives pause and resume and remaining counts down', () {
    FocusTimerState s = const FocusTimerState(totalSeconds: 25 * 60).start(t0, id);
    s = s.pause(t0.add(const Duration(minutes: 10)));
    // Paused for 30 minutes: no time accrues.
    expect(s.elapsedAt(t0.add(const Duration(minutes: 40))), 600);
    s = s.start(t0.add(const Duration(minutes: 40)), () => 'other');
    expect(s.blockId, blockId, reason: 'resume keeps the same block');
    final DateTime now = t0.add(const Duration(minutes: 48));
    expect(s.elapsedAt(now), 18 * 60);
    expect(s.remainingAt(now), 7 * 60);
    expect(s.hasUnsavedAt(now), isTrue);
    expect(focusClock(s.elapsedAt(now)), '18:00');
  });

  test('ending early builds one interrupted row with the real minutes and the block id', () {
    final FocusTimerState s = const FocusTimerState(totalSeconds: 25 * 60).start(t0, id);
    final StudySession? row = buildFocusSession(
      s,
      completed: false,
      now: t0.add(const Duration(minutes: 18, seconds: 10)),
      userId: 'u1',
    );
    expect(row, isNotNull);
    expect(row!.id, blockId);
    expect(row.durationMinutes, 18);
    expect(row.completionState, 'interrupted');
    expect(row.toMap()['completion_state'], 'interrupted');
  });

  test('a natural finish is completed and capped at the deadline', () {
    final FocusTimerState s = const FocusTimerState(totalSeconds: 25 * 60).start(t0, id);
    final StudySession row = buildFocusSession(
      s,
      completed: true,
      now: t0.add(const Duration(minutes: 40)),
      userId: 'u1',
    )!;
    expect(row.durationMinutes, 25);
    expect(row.completionState, 'completed');
    expect(DateTime.parse(row.endedAt!), t0.add(const Duration(minutes: 25)));
  });

  test('under a minute records nothing', () {
    final FocusTimerState s = const FocusTimerState().start(t0, id);
    expect(
      buildFocusSession(s, completed: false, now: t0.add(const Duration(seconds: 25)), userId: 'u1'),
      isNull,
    );
    expect(buildFocusSession(const FocusTimerState(), completed: false, now: t0, userId: 'u1'), isNull);
  });

  test('saved state restores and malformed state is rejected', () {
    final FocusTimerState s = const FocusTimerState(totalSeconds: 30 * 60, activity: 'Revision')
        .start(t0, id)
        .pause(t0.add(const Duration(minutes: 5)));
    final FocusTimerState restored = FocusTimerState.fromJson(jsonEncodeFocus(s));
    expect(restored.blockId, blockId);
    expect(restored.accumulatedSeconds, 300);
    expect(restored.totalSeconds, 1800);
    expect(restored.activity, 'Revision');
    expect(restored.running, isFalse);
    expect(FocusTimerState.fromJson('{nope').started, isFalse);
    expect(FocusTimerState.fromJson('{"total": -5, "accumulated": 99999}').totalSeconds, 25 * 60);
  });

  test('interrupted sessions count as study time; breaks and legacy abandoned do not', () {
    StudySession row(String id, String state, String mode) => StudySession(
          id: id,
          userId: 'u1',
          startedAt: '2026-01-10T05:00:00.000Z',
          endedAt: '2026-01-10T06:00:00.000Z',
          durationMinutes: 20,
          completionState: state,
          mode: mode,
        );
    final AppData data = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      sessions: <StudySession>[
        row('a', 'completed', 'Pomodoro'),
        row('b', 'interrupted', 'Pomodoro'),
        row('c', 'abandoned', 'Pomodoro'),
        row('d', 'completed', 'Short Break'),
      ],
    );
    expect(studyTotals(data, today: '2026-01-10').totalMinutes, 40);
  });
}
