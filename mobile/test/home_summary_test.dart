import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/home_summary.dart';

StudySession session(String id, String startedAt, int minutes, {String state = 'completed'}) => StudySession(
      id: id,
      userId: 'u1',
      startedAt: startedAt,
      durationMinutes: minutes,
      completionState: state,
      mode: 'Study',
      activity: 'Lecture',
    );

void main() {
  group('header', () {
    test('greeting follows the IST hour and the website name order', () {
      final AppData data = AppData.empty('u1');
      // 06:29 UTC = 11:59 IST, 06:30 UTC = 12:00 IST, 11:30 UTC = 17:00 IST.
      expect(homeGreeting(data, DateTime.utc(2026, 10, 25, 6, 29)), 'Good morning, future engineer.');
      expect(greetingPart(DateTime.utc(2026, 10, 25, 6, 30)), 'afternoon');
      expect(greetingPart(DateTime.utc(2026, 10, 25, 11, 30)), 'evening');
      final AppData named = data.copyWith(
        settings: data.settings.copyWith(ownerName: 'Riya'),
        profile: const Profile(id: 'p', userId: 'u1', displayName: 'Profile Name'),
      );
      expect(homeGreeting(named, DateTime.utc(2026, 10, 25, 2)), 'Good morning, Riya.');
      final AppData profileOnly =
          data.copyWith(profile: const Profile(id: 'p', userId: 'u1', displayName: 'Profile Name'));
      expect(homeGreeting(profileOnly, DateTime.utc(2026, 10, 25, 2)), 'Good morning, Profile Name.');
    });

    test('eyebrow is the en-IN IST date, upper-cased', () {
      // 20:00 UTC on the 24th is already Sunday the 25th in India.
      expect(homeDateEyebrow(DateTime.utc(2026, 10, 24, 20)), 'SUNDAY, 25 OCTOBER');
    });

    test('prettyDate matches Intl en-IN short months', () {
      expect(prettyDate('2027-01-24'), '24 Jan 2027');
      expect(prettyDate('2027-09-04'), '4 Sept 2027');
      expect(prettyDate(null), '—');
    });
  });

  group('computeStreaks (web study-time.ts)', () {
    test('empty notebook has no streak', () {
      final StreakSummary s = computeStreaks(AppData.empty('u1'), '2026-10-25');
      expect(<int>[s.current, s.longest, s.weeklyConsistency], <int>[0, 0, 0]);
      expect(s.qualifyingToday, isFalse);
    });

    test('minutes are summed per IST day across every session, like the website', () {
      final AppData data = AppData.empty('u1').copyWith(sessions: <StudySession>[
        // 23:00 IST on the 24th (17:30 UTC) and 00:10 IST on the 25th (18:40 UTC).
        session('a', '2026-10-24T17:30:00.000Z', 10),
        session('b', '2026-10-24T18:40:00.000Z', 8),
        session('c', '2026-10-24T19:00:00.000Z', 8, state: 'abandoned'),
      ]);
      final Set<String> days = qualifyingDays(data);
      expect(days, <String>{'2026-10-25'});
    });

    test('current survives until today ends, longest and weekly count correctly', () {
      final AppData data = AppData.empty('u1').copyWith(
        tests: <TestRecord>[
          const TestRecord(id: 't1', userId: 'u1', title: 'A', testDate: '2026-10-01', testType: 'Chapter Test'),
          const TestRecord(id: 't2', userId: 'u1', title: 'B', testDate: '2026-10-02', testType: 'Chapter Test'),
          const TestRecord(id: 't3', userId: 'u1', title: 'C', testDate: '2026-10-03', testType: 'Chapter Test'),
          const TestRecord(id: 't9', userId: 'u1', title: 'Z', testDate: '2026-10-30', testType: 'Chapter Test'),
        ],
        practiceSessions: <PracticeSession>[
          const PracticeSession(id: 'p1', userId: 'u1', chapterId: 'c1', practiceDate: '2026-10-23', attempted: 5, correct: 3, incorrect: 2),
          const PracticeSession(id: 'p0', userId: 'u1', chapterId: 'c1', practiceDate: '2026-10-20', attempted: 0, correct: 0, incorrect: 0),
        ],
        revisions: <Revision>[
          const Revision(
            id: 'r1',
            userId: 'u1',
            chapterId: 'c1',
            revisionNumber: 1,
            dueOn: '2026-10-24',
            completedAt: '2026-10-24T05:00:00.000Z',
          ),
        ],
      );
      final StreakSummary s = computeStreaks(data, '2026-10-25');
      expect(s.qualifyingToday, isFalse);
      expect(s.current, 2); // 23rd and 24th; today has not counted yet.
      expect(s.longest, 3); // 1st–3rd; the future test on the 30th is ignored.
      expect(s.weeklyConsistency, 2);
    });
  });

  group('computeBigDay', () {
    test('JEE with no dates shows the unset state', () {
      final BigDay day = computeBigDay(AppData.empty('u1'), '2026-10-25');
      expect(day.primary, isNull);
      expect(day.badge, 'JEE 2027');
      expect(day.unsetLabel, 'JEE Main & Advanced');
      expect(day.secondary?.label, 'JEE Main');
      expect(day.secondary?.days, isNull);
    });

    test('JEE Main becomes the big day when Advanced is unset', () {
      final AppData data = AppData.empty('u1');
      final AppData withMain = data.copyWith(
        settings: data.settings.copyWith(mainExamDate: '2027-01-24', examYear: 2027),
        chapters: <Chapter>[
          const Chapter(id: 'c1', userId: 'u1', subject: 'Physics', name: 'A', status: 'Done'),
          const Chapter(id: 'c2', userId: 'u1', subject: 'Physics', name: 'B', status: 'Revised'),
          const Chapter(id: 'c3', userId: 'u1', subject: 'Physics', name: 'C'),
        ],
      );
      final BigDay day = computeBigDay(withMain, '2026-10-25');
      expect(day.primary?.label, 'JEE Main');
      expect(day.primary?.days, 91);
      expect(day.secondary?.label, 'JEE Advanced');
      expect(day.secondary?.dotOrange, isTrue);
      expect('${day.completedChapters}/${day.totalChapters}', '2/3');
    });

    test('Advanced is primary when set; Main is the secondary', () {
      final AppData data = AppData.empty('u1');
      final BigDay day = computeBigDay(
        data.copyWith(
          settings: data.settings.copyWith(mainExamDate: '2027-01-24', advancedExamDate: '2027-05-16'),
        ),
        '2026-10-25',
      );
      expect(day.primary?.label, 'JEE Advanced');
      expect(day.secondary?.label, 'JEE Main');
      expect(day.secondary?.days, 91);
    });

    test('other exams use their title and the boards add-on', () {
      final AppData data = AppData.empty('u1').copyWith(
        examCatalog: <ExamCatalogEntry>[
          const ExamCatalogEntry(id: 'neet-ug', name: 'NEET UG', category: 'Medical', boardsAddon: true),
        ],
      );
      final BigDay day = computeBigDay(
        data.copyWith(
          settings: data.settings.copyWith(examId: 'neet-ug', boardsAddon: true, mainExamDate: '2026-10-24'),
        ),
        '2026-10-25',
      );
      expect(day.badge, 'NEET UG');
      expect(day.primary?.label, 'NEET UG');
      expect(day.primary?.days, -1); // the card clamps this to 0.
      expect(day.secondary?.label, 'Class 12 boards');
      expect(day.secondary?.days, isNull);
    });
  });

  test('exam mode reason text matches the website', () {
    final AppData data = AppData.empty('u1');
    final ExamModeState on = examModeState(
      data.copyWith(settings: data.settings.copyWith(mainExamDate: '2026-11-04')),
      '2026-10-25',
    );
    expect(on.active, isTrue);
    expect(on.reason, 'JEE Main — Session 1 is 10 days left away — inside the final 30 days.');
    final ExamModeState unset = examModeState(data, '2026-10-25');
    expect(unset.active, isFalse);
    expect(unset.reason, 'Add the exam date in Settings to enable automatic Exam Mode.');
  });
}
