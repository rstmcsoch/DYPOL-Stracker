import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/theme/app_theme.dart';
import 'package:stracker/core/theme/palettes.dart';
import 'package:stracker/core/widgets/multi_charts.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/features/analytics/analytics_page.dart';
import 'package:stracker/logic/analytics.dart';
import 'package:stracker/logic/weekly_report.dart';

// Mirrors the website's jee.test.ts fixtures ('weekly report').
const String today = '2026-10-08'; // a Thursday

AppData emptyData({
  List<Chapter> chapters = const <Chapter>[],
  List<PracticeSession> practice = const <PracticeSession>[],
  List<StudySession> sessions = const <StudySession>[],
  List<TestRecord> tests = const <TestRecord>[],
  List<TestSubjectScore> scores = const <TestSubjectScore>[],
}) =>
    AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      chapters: chapters,
      practiceSessions: practice,
      sessions: sessions,
      tests: tests,
      testSubjectScores: scores,
    );

PracticeSession practiceRow(String id, String date, int attempted, int correct, {String chapterId = 'c'}) =>
    PracticeSession(
      id: id,
      userId: 'u1',
      chapterId: chapterId,
      practiceDate: date,
      attempted: attempted,
      correct: correct,
      incorrect: attempted - correct,
    );

Future<void> pumpThemed(WidgetTester tester, Widget child) async {
  final StrackerPalette palette = strackerPalettes['default']!['light']!;
  await tester.pumpWidget(MaterialApp(
    theme: buildStrackerTheme(palette: palette, brightness: Brightness.light),
    home: Scaffold(body: SingleChildScrollView(child: child)),
  ));
  await tester.pump();
}

void main() {
  group('weekly report (website parity)', () {
    test('week runs Monday to today, previous week is the seven days before', () {
      expect(weekRange(today), (start: '2026-10-05', end: today));
      expect(previousWeekRange(today), (start: '2026-09-28', end: '2026-10-04'));
      expect(weekRange('2026-10-05'), (start: '2026-10-05', end: '2026-10-05'));
      expect(weekRange('2026-10-11').start, '2026-10-05');
    });

    test('does not fabricate a comparison without previous-week history', () {
      final WeeklyReport report =
          buildWeeklyReport(emptyData(practice: <PracticeSession>[practiceRow('p', today, 20, 16)]), today);
      expect(report.comparisons, isEmpty);
      expect(report.historyNote, contains('Not enough history'));
      expect(report.questionsAttempted, 20);
      expect(report.practiceAccuracy, 80);
      expect(report.activeDays, 1);
      expect(report.actionable, 'Log a practice block or test this week to get a specific action.');
    });

    test('reports a real subject drop when both weeks have data', () {
      const Chapter maths = Chapter(id: 'm', userId: 'u1', subject: 'Maths', name: 'Integrals');
      final WeeklyReport report = buildWeeklyReport(
        emptyData(chapters: <Chapter>[
          maths
        ], practice: <PracticeSession>[
          practiceRow('prev', '2026-10-01', 20, 16, chapterId: 'm'),
          practiceRow('now', today, 20, 12, chapterId: 'm'),
        ]),
        today,
      );
      expect(report.comparisons.join(' '), contains('Maths performance dropped 20 points'));
      expect(report.historyNote, 'Comparisons use subjects with data in both weeks.');
      expect(report.actionable, report.comparisons.first);
      expect(report.strongestSubject?.subject, 'Maths');
      expect(report.weakestArea?.name, 'Integrals');
    });

    test('minutes are split by activity and limited to this week', () {
      StudySession s(String id, String date, int minutes, String activity) => StudySession(
            id: id,
            userId: 'u1',
            startedAt: '${date}T05:00:00.000Z',
            durationMinutes: minutes,
            activity: activity,
          );
      final WeeklyReport report = buildWeeklyReport(
        emptyData(sessions: <StudySession>[
          s('a', '2026-10-06', 50, 'Lecture'),
          s('b', today, 25, 'Revision'),
          s('old', '2026-10-02', 90, 'Lecture'),
        ]),
        today,
      );
      expect(report.studiedMinutes, 75);
      expect(report.activity.of('Lecture'), 50);
      expect(report.activity.of('Revision'), 25);
      expect(report.activeDays, 2);
      expect(report.historyNote, contains('Not enough overlapping subject data'));
    });

    test('jsRound matches Math.round', () {
      expect(jsRound(2.5), 3);
      expect(jsRound(-2.5), -2);
      expect(jsRound(-2.6), -3);
    });
  });

  group('marks trend (website getMarksTrend)', () {
    test('one row per test by date, subject % and full mocks grouped by subject', () {
      final AppData data = emptyData(tests: <TestRecord>[
        const TestRecord(
            id: 'b',
            userId: 'u1',
            title: 'Chapter test',
            testDate: '2026-10-03',
            testType: 'Chapter Test',
            subject: 'Physics',
            marksObtained: 30,
            totalMarks: 40),
        const TestRecord(id: 'a', userId: 'u1', title: 'Mock 1', testDate: '2026-09-20', testType: 'Full Mock'),
      ], scores: const <TestSubjectScore>[
        TestSubjectScore(id: 's1', userId: 'u1', testId: 'a', subject: 'Physics', marksObtained: 50, totalMarks: 100),
        TestSubjectScore(id: 's2', userId: 'u1', testId: 'a', subject: 'Chemistry', marksObtained: 60, totalMarks: 100),
        TestSubjectScore(id: 's3', userId: 'u1', testId: 'a', subject: 'Maths', marksObtained: null, totalMarks: 100),
      ]);
      final List<({String date, double? overall, Map<String, double?> bySubject})> rows = marksTrend(data);
      expect(rows.map((r) => r.date).toList(), <String>['2026-09-20', '2026-10-03']);
      expect(rows.first.bySubject['Physics'], 50);
      expect(rows.first.bySubject['Chemistry'], 60);
      expect(rows.first.bySubject['Maths'], isNull, reason: 'an incomplete subject row is not guessed');
      expect(rows.last.bySubject, <String, double?>{'Physics': 75});
      expect(rows.last.overall, 75);
      expect(marksTrend(data, since: '2026-10-01'), hasLength(1));
    });
  });

  test('Indian digit grouping for large counts', () {
    expect(indianGrouping(999), '999');
    expect(indianGrouping(1000), '1,000');
    expect(indianGrouping(123456), '1,23,456');
    expect(indianGrouping(12345678), '1,23,45,678');
    expect(indianGrouping(-123456), '-1,23,456');
  });

  test('pins are stored per account, like the website', () {
    expect(pinnedStorageKey('u1'), 'stracker-pinned-charts:u1');
    expect(pinLimit, 3);
    expect(chartIds.toSet(), hasLength(chartIds.length));
  });

  testWidgets('Your week card renders real numbers and the next change', (WidgetTester tester) async {
    await pumpThemed(
      tester,
      WeeklyReportCard(data: emptyData(practice: <PracticeSession>[practiceRow('p', today, 20, 16)]), today: today),
    );
    expect(tester.takeException(), isNull);
    expect(find.textContaining('Not enough history'), findsOneWidget);
    expect(find.textContaining('Next change'), findsOneWidget);
  });

  for (final double width in <double>[320, 412, 800]) {
    testWidgets('trend and radar charts paint at width $width without overflow', (WidgetTester tester) async {
      tester.view.physicalSize = Size(width * 2, 1600);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      final DateTime start = DateTime.utc(2026, 9, 1);
      final List<int> times = <int>[
        for (int i = 0; i < 30; i++) start.add(Duration(days: i * 3)).millisecondsSinceEpoch
      ];
      await pumpThemed(
        tester,
        Column(children: <Widget>[
          MultiLineChart(
            times: times,
            tickLabel: (int t) => '${DateTime.fromMillisecondsSinceEpoch(t, isUtc: true).day}',
            series: <ChartSeries>[
              ChartSeries(
                  label: 'Overall',
                  color: Colors.black,
                  dashed: true,
                  values: <double?>[for (int i = 0; i < 30; i++) 40 + i.toDouble()]),
              ChartSeries(
                  label: 'Physics',
                  color: Colors.blue,
                  values: <double?>[for (int i = 0; i < 30; i++) i.isEven ? null : 30 + i.toDouble()]),
              ChartSeries(label: 'Chemistry', color: Colors.green, values: <double?>[for (int i = 0; i < 30; i++) 100]),
            ],
          ),
          const RadarChart(labels: <String>['Physics', 'Chemistry', 'Maths'], values: <double>[45, 80, 0]),
        ]),
      );
      expect(tester.takeException(), isNull);
      expect(find.byType(CustomPaint), findsWidgets);
    });
  }
}
