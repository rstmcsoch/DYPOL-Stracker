import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/aggregation.dart';

AppData withSessions(List<StudySession> sessions) => AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      sessions: sessions,
    );

StudySession session(String id, String date, int minutes, {String state = 'completed', String mode = 'Study'}) =>
    StudySession(
      id: id,
      userId: 'u1',
      startedAt: '${date}T10:00:00.000Z',
      endedAt: '${date}T11:00:00.000Z',
      durationMinutes: minutes,
      completionState: state,
      mode: mode,
      activity: 'Lecture',
    );

void main() {
  test('breaks and unfinished sessions are not study time', () {
    final AppData data = withSessions(<StudySession>[
      session('s1', '2026-01-10', 60),
      session('s2', '2026-01-10', 15, mode: 'Short Break'),
      session('s3', '2026-01-10', 40, state: 'abandoned'),
    ]);
    final StudyTotals totals = studyTotals(data, today: '2026-01-10');
    expect(totals.todayMinutes, 60);
    expect(totals.totalMinutes, 60);
  });

  test('the streak survives a day that has no evidence yet', () {
    final AppData data = withSessions(<StudySession>[
      session('s1', '2026-01-07', 30),
      session('s2', '2026-01-08', 30),
      session('s3', '2026-01-09', 30),
    ]);
    expect(studyTotals(data, today: '2026-01-10').streak, 3);
    expect(studyTotals(data, today: '2026-01-11').streak, 0);
  });

  test('the consistency strip covers the requested window, oldest first', () {
    final AppData data = withSessions(<StudySession>[session('s1', '2026-01-10', 90)]);
    final List<({String date, int minutes})> strip = consistencyStrip(data, today: '2026-01-10', days: 7);
    expect(strip.length, 7);
    expect(strip.last.date, '2026-01-10');
    expect(strip.last.minutes, 90);
    expect(strip.first.minutes, 0);
  });

  test('practice minutes are counted once, even when mirrored into study time', () {
    final AppData mirrored = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      sessions: <StudySession>[
        StudySession(
          id: 's1',
          userId: 'u1',
          startedAt: '2026-01-10T10:00:00.000Z',
          durationMinutes: 30,
          completionState: 'completed',
          mode: 'Study',
          activity: 'Practice',
          chapterId: 'c1',
        ),
      ],
      practiceSessions: <PracticeSession>[
        const PracticeSession(
          id: 'p1',
          userId: 'u1',
          chapterId: 'c1',
          practiceDate: '2026-01-10',
          attempted: 10,
          correct: 8,
          incorrect: 2,
          timeMinutes: 30,
        ),
      ],
    );
    expect(studyTotals(mirrored, today: '2026-01-10').todayMinutes, 30);
  });
}
