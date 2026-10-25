import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/date.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/charts.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/analytics.dart';
import '../../logic/home_summary.dart';
import '../../logic/progress.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';
import '../tests/tests_page.dart';

/// Analytics, card for card with the website's AnalyticsPage: learning pipeline, the four
/// KPIs, marks & subjects, attempt metrics, mistake breakdown, study hours, the 16-week
/// heatmap, syllabus progress, mock target and chapter signals. Only recorded data is used.
class AnalyticsPage extends ConsumerStatefulWidget {
  const AnalyticsPage({super.key});

  @override
  ConsumerState<AnalyticsPage> createState() => _AnalyticsPageState();
}

String _fmt(double value, [int digits = 0]) {
  final String fixed = value.toStringAsFixed(digits);
  return digits > 0 && fixed.contains('.') ? fixed.replaceFirst(RegExp(r'\.?0+$'), '') : fixed;
}

String _duration(int minutes) {
  final int hours = minutes ~/ 60;
  final int mins = minutes % 60;
  if (hours == 0) return '${mins}m';
  return mins == 0 ? '${hours}h' : '${hours}h ${mins}m';
}

class _AnalyticsPageState extends ConsumerState<AnalyticsPage> {
  String _range = '90';
  String _hoursView = 'day';

  /// The website's "Export trend CSV": same columns and file name, handed to the share sheet.
  Future<void> _exportTrendCsv(AppData data) async {
    await HapticFeedback.lightImpact();
    try {
      final Directory base = await getApplicationDocumentsDirectory();
      final Directory dir = Directory('${base.path}/stracker-exports');
      if (!dir.existsSync()) dir.createSync(recursive: true);
      final File file = File('${dir.path}/stracker-performance.csv');
      await file.writeAsString(trendCsv(data));
      await Share.shareXFiles(<XFile>[XFile(file.path, mimeType: 'text/csv')], subject: 'Stracker performance trend');
      if (mounted) showToast(context, 'Performance trend exported as CSV.');
    } catch (error) {
      if (mounted) showToast(context, 'Could not export the trend: $error', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final String today = todayIso();
    final MeanResult overall = meanTestPercentage(data.tests, data.testSubjectScores);
    final List<({String subject, double? average, int count})> subjects = subjectPerformance(data);
    final List<ChapterPerformance> chapterRows = chapterPerformance(data);
    final ({int correct, int attempted, double? rate}) accuracy = attemptAccuracy(data);
    final ({int attempted, int total, double? rate}) attempt = attemptRate(data);
    final ({double totalNegativeMarks, double? percentage, int testsIncluded}) negative = negativeMarkImpact(data);
    final List<({String type, int count})> mistakes = mistakeCounts(data);
    final int totalChapters = data.chapters.length;
    final int doneChapters = data.chapters.where((Chapter c) => c.status == 'Done' || c.status == 'Revised').length;
    final int totalMinutes = data.sessions.fold<int>(0, (int s, StudySession x) => s + x.durationMinutes);
    final bool hasSessions = data.sessions.any((StudySession s) => s.durationMinutes > 0);
    final bool hasMistakes = mistakes.any((({String type, int count}) m) => m.count > 0);
    final bool hasSubjectScores = subjects.any((({String subject, double? average, int count}) s) => s.average != null);
    final List<TrendPoint> allTrend = testTrend(data, limit: 5000);
    final String? since =
        _range == 'all' ? null : isoDate(parseIsoDate(today)!.subtract(Duration(days: int.parse(_range))));
    final List<TrendPoint> trend =
        allTrend.where((TrendPoint p) => since == null || p.date.compareTo(since) >= 0).toList();
    final bool hasTestScore = allTrend.isNotEmpty;
    final bool hasAttemptData =
        accuracy.rate != null || attempt.rate != null || negative.totalNegativeMarks > 0 || data.sessions.isNotEmpty;
    final ({double score, double gap, String state})? target = mockTargetComparison(data);
    final Map<String, int> stages = stageCounts(data);
    final SyllabusProgress progress = syllabusProgress(data);
    final TextStyle? muted = text.bodySmall?.copyWith(color: colors.muted);

    Widget eyebrow(String value) => Text(value,
        style: text.labelSmall?.copyWith(color: colors.muted, letterSpacing: 0.8, fontWeight: FontWeight.w700));

    Widget chartHead(String kicker, String title, String note, {Widget? action}) => Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    eyebrow(kicker),
                    Text(title, style: text.titleMedium),
                    Text(note, style: muted),
                  ],
                ),
              ),
              if (action != null) ...<Widget>[const SizedBox(width: 8), action],
            ],
          ),
        );

    Widget noData(String label, String hint) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('$label — No data yet', style: text.titleSmall),
            Text(hint, style: muted),
          ],
        );

    Widget kpi(IconData icon, String label, String value, String note) => NotebookCard(
          dense: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(children: <Widget>[
                Icon(icon, size: 15, color: colors.muted),
                const SizedBox(width: 5),
                Flexible(child: eyebrow(label)),
              ]),
              const SizedBox(height: 4),
              Text(value, style: text.headlineSmall),
              Text(note, style: muted),
            ],
          ),
        );

    Widget metric(String label, Color tone, String value, String note, {double? bar, String? extra}) => NotebookCard(
          dense: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(children: <Widget>[
                Container(width: 8, height: 8, decoration: BoxDecoration(color: tone, shape: BoxShape.circle)),
                const SizedBox(width: 6),
                Flexible(child: eyebrow(label)),
              ]),
              const SizedBox(height: 4),
              Text(value, style: text.headlineSmall),
              Text(note, style: muted),
              if (bar != null) ...<Widget>[
                const SizedBox(height: 6),
                LinearBar(value: (bar / 100).clamp(0, 1).toDouble(), color: tone),
              ],
              if (extra != null) Text(extra, style: text.labelSmall?.copyWith(color: colors.muted)),
            ],
          ),
        );

    return NotebookScaffold(
      title: 'Analytics',
      showBrand: true,
      body: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            runSpacing: 6,
            children: <Widget>[
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Analytics', style: text.headlineLarge),
                  Text('Only from data you entered.', style: muted),
                ],
              ),
              OutlinedButton.icon(
                onPressed: () => _exportTrendCsv(data),
                icon: const Icon(Icons.bar_chart, size: 18),
                label: const Text('Export trend CSV'),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const SectionHeading('Learning pipeline'),
          Text('Stages are independent; counts can overlap.', style: muted),
          const SizedBox(height: 6),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                WrapGrid(
                  minItemWidth: 110,
                  children: <Widget>[
                    for (final String key in chapterStageKeys)
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(_stageLabel[key] ?? key, style: text.labelSmall?.copyWith(color: colors.muted)),
                          Text('${stages[key] ?? 0}/$totalChapters', style: text.titleMedium),
                          LinearBar(
                            value: totalChapters == 0 ? 0 : (stages[key] ?? 0) / totalChapters,
                            color: key == 'tested' ? colors.palette.green : colors.palette.accent,
                            height: 5,
                          ),
                        ],
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 18,
                  runSpacing: 6,
                  children: <Widget>[
                    Text('Raw completion  ${progress.raw == null ? '—' : '${progress.raw!.round()}%'}',
                        style: text.labelMedium),
                    Text(
                      'Weighted completion  ${progress.weighted == null ? '—' : '${progress.weighted!.round()}%'}',
                      style: text.labelMedium,
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          WrapGrid(
            minItemWidth: 150,
            children: <Widget>[
              kpi(Icons.show_chart, 'TESTS LOGGED', '${data.tests.length}',
                  '${overall.count} with usable test results'),
              kpi(
                Icons.menu_book_outlined,
                'SYLLABUS',
                totalChapters == 0 ? '—' : '$doneChapters/$totalChapters',
                totalChapters == 0
                    ? 'No chapters saved'
                    : '${(doneChapters / totalChapters * 100).round()}% chapters completed',
              ),
              kpi(
                Icons.schedule,
                'STUDY HOURS',
                _fmt(totalMinutes / 60, 1),
                '${data.sessions.length} logged focus session${data.sessions.length == 1 ? '' : 's'}',
              ),
              kpi(
                Icons.track_changes,
                'TEST AVERAGE',
                overall.average == null ? '—' : '${overall.average!.round()}%',
                overall.count > 0
                    ? 'Mean of ${overall.count} usable test result${overall.count == 1 ? '' : 's'}; one test counts once'
                    : 'Add a scored test to begin',
              ),
            ],
          ),
          if (data.tests.isEmpty) ...<Widget>[
            const SizedBox(height: 10),
            NotebookCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Wrap(spacing: 8, runSpacing: 4, children: <Widget>[
                    const Pill('EXAMPLE · NOT YOUR DATA', icon: Icons.auto_awesome, dense: true, tone: PillTone.accent),
                    eyebrow('WHAT 3 TESTS UNLOCK'),
                  ]),
                  const SizedBox(height: 8),
                  Text(
                    'After 3 tests, you’ll see your marks trend, subject balance, weak areas, and performance '
                    'patterns here — built only from what you actually log.',
                    style: text.bodyMedium,
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () => openTestEditor(context, ref, data, null),
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Log your first test'),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                chartHead(
                  'PERCENTAGE, NOT RAW MARKS',
                  'Marks & subjects',
                  'The trend of your comparable results, with the subject balance beside it.',
                ),
                if (!hasTestScore && !hasSubjectScores)
                  noData('Marks & subjects', 'Log a test with marks and a total to start the trend.')
                else ...<Widget>[
                  if (hasTestScore) ...<Widget>[
                    AppSelect<String>(
                      label: 'Choose marks trend range',
                      value: _range,
                      items: const <String>['30', '90', '180', 'all'],
                      labelFor: (String v) => switch (v) {
                        '30' => 'Last 30 days',
                        '90' => 'Last 90 days',
                        '180' => 'Last 6 months',
                        _ => 'All recorded tests',
                      },
                      onChanged: (String? v) => setState(() => _range = v ?? _range),
                    ),
                    if (trend.isEmpty)
                      noData('Marks trend', 'No comparable test result in this range yet.')
                    else
                      LineSeriesChart(
                        points: <double>[for (final TrendPoint p in trend) p.percentage],
                        labels: <String>[for (final TrendPoint p in trend) prettyDate(p.date)],
                        height: 160,
                      ),
                  ],
                  const SizedBox(height: 10),
                  if (hasSubjectScores)
                    WrapGrid(
                      minItemWidth: 110,
                      children: <Widget>[
                        for (final ({String subject, double? average, int count}) s in subjects)
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Pill(s.subject, dense: true),
                              Text(s.average == null ? '—' : '${s.average!.round()}%', style: text.titleMedium),
                              Text('${s.count} result${s.count == 1 ? '' : 's'}', style: muted),
                              LinearBar(
                                value: ((s.average ?? 0) / 100).clamp(0, 1).toDouble(),
                                color: colors.subjectColor(s.subject),
                                height: 5,
                              ),
                            ],
                          ),
                      ],
                    )
                  else
                    noData('Subject balance', 'Add scores to any subject test or mock to compare subjects.'),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(2, 16, 2, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('How the attempts are landing', style: text.titleMedium),
                Text('Every calculation is based only on the fields you’ve filled in.', style: muted),
              ],
            ),
          ),
          if (hasAttemptData)
            WrapGrid(
              minItemWidth: 150,
              children: <Widget>[
                metric(
                  'ACCURACY',
                  colors.palette.green,
                  accuracy.rate == null ? '—' : '${accuracy.rate!.round()}%',
                  '${accuracy.correct} correct / ${accuracy.attempted == 0 ? '—' : accuracy.attempted} attempted',
                  bar: accuracy.rate ?? 0,
                ),
                metric(
                  'ATTEMPT RATE',
                  colors.palette.accent,
                  attempt.rate == null ? '—' : '${attempt.rate!.round()}%',
                  '${attempt.attempted} attempted / ${attempt.total == 0 ? '—' : attempt.total} total questions',
                  bar: attempt.rate ?? 0,
                ),
                metric(
                  'NEGATIVE MARKS',
                  colors.palette.orange,
                  negative.totalNegativeMarks > 0 || data.tests.any((TestRecord t) => t.negativeMarks == 0)
                      ? _fmt(negative.totalNegativeMarks, 1)
                      : '—',
                  negative.percentage == null
                      ? 'No test has both recorded negative marks and a usable total'
                      : '${negative.percentage!.toStringAsFixed(1)}% of totals from ${negative.testsIncluded} comparable '
                          'test${negative.testsIncluded == 1 ? '' : 's'}',
                  bar: negative.percentage,
                ),
                metric(
                  'STUDY TIME',
                  colors.palette.textAccent,
                  _duration(totalMinutes),
                  '${data.sessions.where((StudySession s) => s.completionState == 'completed').length} completed focus sessions',
                  extra: 'No sessions? Start the timer in Focus mode.',
                ),
              ],
            )
          else
            NotebookCard(
              child: noData('Attempt metrics', 'Log correct/wrong counts with a test, or run a focus session.'),
            ),
          const SizedBox(height: 10),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                chartHead(
                  'NOTICE THE REPEATS',
                  'Mistake breakdown',
                  'Only entries saved in your notebook appear here.',
                  action: TextButton(
                    onPressed: () => Routes.open(context, Routes.mistakes),
                    child: const Text('Open notebook ↗'),
                  ),
                ),
                if (hasMistakes) ...<Widget>[
                  _Bars(
                    values: <double>[for (final ({String type, int count}) m in mistakes) m.count.toDouble()],
                    labels: <String>[for (final ({String type, int count}) m in mistakes) m.type],
                    colors: <Color>[
                      colors.palette.accent,
                      colors.palette.orange,
                      colors.palette.green,
                      colors.palette.red,
                      colors.muted,
                    ],
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 12,
                    runSpacing: 4,
                    children: <Widget>[
                      for (final ({String type, int count}) m in mistakes)
                        Text('${m.type} ${m.count}', style: text.labelMedium),
                    ],
                  ),
                ] else
                  noData('Mistake breakdown', 'A few honest notes in the mistake notebook make this useful.'),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                chartHead('SHOWING UP COUNTS', 'Study hours', 'Logged focus sessions only.'),
                SegmentedButton<String>(
                  segments: const <ButtonSegment<String>>[
                    ButtonSegment<String>(value: 'day', label: Text('day')),
                    ButtonSegment<String>(value: 'week', label: Text('week')),
                    ButtonSegment<String>(value: 'month', label: Text('month')),
                  ],
                  selected: <String>{_hoursView},
                  showSelectedIcon: false,
                  onSelectionChanged: (Set<String> value) {
                    HapticFeedback.selectionClick();
                    setState(() => _hoursView = value.first);
                  },
                ),
                const SizedBox(height: 10),
                if (hasSessions)
                  Builder(builder: (BuildContext context) {
                    final List<({String date, String label, double hours})> bars = studyBars(data, _hoursView, today);
                    return _Bars(
                      values: <double>[for (final ({String date, String label, double hours}) b in bars) b.hours],
                      labels: <String>[for (final ({String date, String label, double hours}) b in bars) b.label],
                      colors: <Color>[colors.palette.green],
                      sparseLabels: true,
                    );
                  })
                else
                  noData('Study hours', 'Run a focus session — the timer logs your study time.'),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                chartHead(
                  'A CALENDAR OF SHOWING UP',
                  'Study-day rhythm',
                  'Day intensity is compared with your current daily study goal.',
                ),
                if (hasSessions)
                  _Heatmap(data: data, today: today)
                else
                  noData('Study-day rhythm', 'Complete a focus block to light up your first day.'),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                chartHead(
                  'CHAPTERS MOVING FORWARD',
                  'Syllabus progress',
                  '$doneChapters done or revised of $totalChapters recorded chapters.',
                  action: ProgressRing(
                    value: totalChapters == 0 ? 0 : doneChapters / totalChapters * 100,
                    size: 64,
                    stroke: 6,
                  ),
                ),
                if (totalChapters == 0)
                  noData('Syllabus progress', 'Chapters appear here as soon as your syllabus has rows.')
                else
                  for (final ({String subject, double? average, int count}) s in subjects)
                    Builder(builder: (BuildContext context) {
                      final List<Chapter> list = data.chapters.where((Chapter c) => c.subject == s.subject).toList();
                      final int done = list.where((Chapter c) => c.status == 'Done' || c.status == 'Revised').length;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Row(children: <Widget>[
                              Expanded(child: Text(s.subject, style: text.titleSmall, overflow: TextOverflow.ellipsis)),
                              Text('$done / ${list.length} chapters', style: muted),
                            ]),
                            const SizedBox(height: 3),
                            LinearBar(
                              value: list.isEmpty ? 0 : done / list.length,
                              color: colors.subjectColor(s.subject),
                              height: 6,
                            ),
                          ],
                        ),
                      );
                    }),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                chartHead(
                  'A TARGET, NOT A VERDICT',
                  'Mock target',
                  'New mocks need all three subject scores; valid saved legacy totals remain comparable.',
                  action: Icon(Icons.track_changes, size: 20, color: colors.muted),
                ),
                if (target == null)
                  noData('Mock target', 'Add all three subject scores on a full mock to compare it with your target.')
                else
                  Wrap(
                    spacing: 16,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: <Widget>[
                      Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                        Text(_fmt(target.score, 1), style: text.headlineSmall),
                        Text('latest mock marks', style: muted),
                      ]),
                      Text(
                        target.state == 'above'
                            ? '↑'
                            : target.state == 'near'
                                ? '≈'
                                : '↓',
                        style: text.headlineSmall,
                      ),
                      Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                        Text(_fmt(data.settings.targetScore), style: text.headlineSmall),
                        Text('target score', style: muted),
                      ]),
                      Pill(
                        '${target.state == 'above' ? 'Above target' : target.state == 'near' ? 'Near target' : 'Below target'}'
                        ' · ${target.gap > 0 ? '${_fmt(target.gap, 1)} to go' : '${_fmt(target.gap.abs(), 1)} ahead'}',
                        tone: target.state == 'above'
                            ? PillTone.good
                            : target.state == 'near'
                                ? PillTone.warn
                                : PillTone.bad,
                      ),
                    ],
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            child: Row(
              children: <Widget>[
                Text('✎', style: text.titleLarge?.copyWith(color: colors.palette.accent)),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      eyebrow('CHAPTER SIGNALS'),
                      Text(
                        '${chapterRows.where((ChapterPerformance c) => c.classification == 'Untested').length} untested · '
                        '${chapterRows.where((ChapterPerformance c) => c.classification == 'Weak').length} weak · '
                        '${chapterRows.where((ChapterPerformance c) => c.dropping).length} dropping',
                        style: text.bodyMedium,
                      ),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: () => Routes.open(context, Routes.weakAreas),
                  child: const Text('See weak areas ↗'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

const Map<String, String> _stageLabel = <String, String>{
  'theory': 'Theory',
  'notes': 'Notes',
  'pyqs': 'PYQs',
  'revised': 'Revised',
  'tested': 'Tested',
};

/// Simple vertical bar chart: bars relative to the largest value, labels underneath.
class _Bars extends StatelessWidget {
  const _Bars({required this.values, required this.labels, required this.colors, this.sparseLabels = false});

  final List<double> values;
  final List<String> labels;
  final List<Color> colors;
  final bool sparseLabels;

  @override
  Widget build(BuildContext context) {
    final double max = values.fold<double>(0, (double a, double b) => a > b ? a : b);
    final TextStyle? label = Theme.of(context).textTheme.labelSmall?.copyWith(color: context.stracker.muted);
    final int step = sparseLabels && values.length > 8 ? (values.length / 5).ceil() : 1;
    return Semantics(
      label: <String>[for (int i = 0; i < values.length; i += 1) '${labels[i]} ${_fmt(values[i], 1)}'].join(', '),
      child: Column(
        children: <Widget>[
          SizedBox(
            height: 150,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                for (int i = 0; i < values.length; i += 1)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: <Widget>[
                          if (values[i] > 0 && !sparseLabels) Text(_fmt(values[i], 1), style: label, maxLines: 1),
                          FractionallySizedBox(
                            widthFactor: 0.8,
                            child: Container(
                              height:
                                  max == 0 ? 0 : (values[i] / max * 120).clamp(values[i] > 0 ? 2 : 0, 120).toDouble(),
                              decoration: BoxDecoration(
                                color: colors[i % colors.length],
                                borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: <Widget>[
              for (int i = 0; i < labels.length; i += 1)
                Expanded(
                  child: Text(
                    i % step == 0 ? labels[i] : '',
                    style: label,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.clip,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The website's 16-week study heatmap: one column per Monday-start week.
class _Heatmap extends StatelessWidget {
  const _Heatmap({required this.data, required this.today});

  final AppData data;
  final String today;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final ({List<({String date, int minutes, String level, bool future})> cells, int daysLogged}) map =
        studyHeatmap(data, today);
    Color shade(String level, bool future) {
      if (future) return Colors.transparent;
      return switch (level) {
        'low' => colors.palette.green.withValues(alpha: 0.25),
        'medium' => colors.palette.green.withValues(alpha: 0.5),
        'high' => colors.palette.green.withValues(alpha: 0.75),
        'goal' => colors.palette.green,
        _ => colors.palette.line.withValues(alpha: 0.5),
      };
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Semantics(
          label: 'Study activity heatmap for the last 16 weeks',
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final double cell = ((constraints.maxWidth - 15 * 3) / 16).clamp(6, 22).toDouble();
              return Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  for (int week = 0; week < 16; week += 1)
                    Padding(
                      padding: EdgeInsets.only(right: week == 15 ? 0 : 3),
                      child: Column(
                        children: <Widget>[
                          for (int day = 0; day < 7; day += 1)
                            Builder(builder: (BuildContext context) {
                              final ({String date, int minutes, String level, bool future}) c =
                                  map.cells[week * 7 + day];
                              return Tooltip(
                                message: c.future
                                    ? '${prettyDate(c.date)} · Upcoming'
                                    : '${prettyDate(c.date)} · ${_duration(c.minutes)}',
                                child: Container(
                                  width: cell,
                                  height: cell,
                                  margin: const EdgeInsets.only(bottom: 3),
                                  decoration: BoxDecoration(
                                    color: shade(c.level, c.future),
                                    borderRadius: BorderRadius.circular(3),
                                    border: c.future ? Border.all(color: colors.palette.line) : null,
                                  ),
                                ),
                              );
                            }),
                        ],
                      ),
                    ),
                ],
              );
            },
          ),
        ),
        const SizedBox(height: 4),
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          spacing: 8,
          children: <Widget>[
            Text(
              '${map.daysLogged} study day${map.daysLogged == 1 ? '' : 's'} shown',
              style: text.labelSmall?.copyWith(color: colors.muted),
            ),
            Text('Consistency over intensity.', style: text.labelSmall?.copyWith(color: colors.muted)),
          ],
        ),
      ],
    );
  }
}
