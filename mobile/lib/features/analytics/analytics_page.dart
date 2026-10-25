import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/date.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/multi_charts.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/analytics.dart';
import '../../logic/home_summary.dart';
import '../../logic/progress.dart';
import '../../logic/weekly_report.dart';
import '../../main.dart' show preferencesProvider;
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

const List<String> _months = <String>[
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/// The website's chart tick: "5 Oct".
String _shortDate(DateTime d) => '${d.day} ${_months[d.month - 1]}';

String _duration(int minutes) {
  final int hours = minutes ~/ 60;
  final int mins = minutes % 60;
  if (hours == 0) return '${mins}m';
  return mins == 0 ? '${hours}h' : '${hours}h ${mins}m';
}

/// The website's pinned charts: up to three, a device-level preference per account.
const int pinLimit = 3;
const List<String> chartIds = <String>['performance', 'mistakes', 'study-hours', 'heatmap', 'syllabus', 'target'];
const Map<String, String> chartTitles = <String, String>{
  'performance': 'Marks & subjects',
  'mistakes': 'Mistake breakdown',
  'study-hours': 'Study hours',
  'heatmap': 'Study-day rhythm',
  'syllabus': 'Syllabus progress',
  'target': 'Mock target',
};

String pinnedStorageKey(String userId) => 'stracker-pinned-charts:$userId';

class _AnalyticsPageState extends ConsumerState<AnalyticsPage> {
  String _range = '90';
  String _hoursView = 'day';
  List<String>? _pinned;

  SharedPreferences? get _prefs {
    try {
      return ref.read(preferencesProvider);
    } catch (_) {
      return null; // No store (tests): pinning still works for the session.
    }
  }

  List<String> _loadPinned(String userId) {
    final List<String> raw = _prefs?.getStringList(pinnedStorageKey(userId)) ?? const <String>[];
    return raw.where(chartIds.contains).take(pinLimit).toList();
  }

  Future<void> _togglePin(String userId, String id) async {
    final List<String> current = List<String>.from(_pinned ?? _loadPinned(userId));
    if (current.contains(id)) {
      current.remove(id);
    } else if (current.length >= pinLimit) {
      showToast(
        context,
        'You can pin up to $pinLimit charts. Unpin one first — try the pin button on '
        '“${chartTitles[current.first]}”.',
        error: true,
      );
      return;
    } else {
      current.add(id);
      showToast(context, '${chartTitles[id]} pinned to your favourites.');
    }
    setState(() => _pinned = current);
    await HapticFeedback.selectionClick();
    await _prefs?.setStringList(pinnedStorageKey(userId), current);
  }

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
    final String? since =
        _range == 'all' ? null : isoDate(parseIsoDate(today)!.subtract(Duration(days: int.parse(_range))));
    final List<({String date, double? overall, Map<String, double?> bySubject})> trendRows =
        marksTrend(data, since: since);
    final bool hasTestScore = marksTrend(data).any(
        (({String date, double? overall, Map<String, double?> bySubject}) r) =>
            r.overall != null || r.bySubject.values.any((double? v) => v != null));
    final bool hasAttemptData =
        accuracy.rate != null || attempt.rate != null || negative.totalNegativeMarks > 0 || data.sessions.isNotEmpty;
    final ({double score, double gap, String state})? target = mockTargetComparison(data);
    final Map<String, int> stages = stageCounts(data);
    final SyllabusProgress progress = syllabusProgress(data);
    final TextStyle? muted = text.bodySmall?.copyWith(color: colors.muted);

    Widget eyebrow(String value) => Text(value,
        style: text.labelSmall?.copyWith(color: colors.muted, letterSpacing: 0.8, fontWeight: FontWeight.w700));

    final List<String> pinned = _pinned ??= _loadPinned(data.userId.isEmpty ? 'session' : data.userId);
    Widget pinButton(String id) {
      final bool on = pinned.contains(id);
      final String title = chartTitles[id]!;
      return IconButton(
        visualDensity: VisualDensity.compact,
        tooltip: on ? 'Unpin $title' : 'Pin $title to favourites',
        isSelected: on,
        icon: Icon(on ? Icons.push_pin : Icons.push_pin_outlined,
            size: 17, color: on ? colors.palette.accent : colors.muted),
        onPressed: () => _togglePin(data.userId.isEmpty ? 'session' : data.userId, id),
      );
    }

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
              if (chartTitles.entries.where((MapEntry<String, String> e) => e.value == title).isNotEmpty)
                pinButton(chartTitles.entries.firstWhere((MapEntry<String, String> e) => e.value == title).key),
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

    Widget cardFor(String id) {
      switch (id) {
        case 'performance':
          return NotebookCard(
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
                    if (!trendRows.any((({String date, double? overall, Map<String, double?> bySubject}) r) =>
                        r.overall != null || r.bySubject.values.any((double? v) => v != null)))
                      noData('Marks trend', 'No comparable test result in this range yet.')
                    else
                      MultiLineChart(
                        times: <int>[
                          for (final ({String date, double? overall, Map<String, double?> bySubject}) r in trendRows)
                            parseIsoDate(r.date)!.millisecondsSinceEpoch,
                        ],
                        tickLabel: (int t) => _shortDate(DateTime.fromMillisecondsSinceEpoch(t)),
                        series: <ChartSeries>[
                          ChartSeries(
                            label: 'Overall',
                            color: colors.palette.inkSoft,
                            dashed: true,
                            values: <double?>[
                              for (final ({String date, double? overall, Map<String, double?> bySubject}) r
                                  in trendRows)
                                r.overall,
                            ],
                          ),
                          for (final ({String subject, double? average, int count}) s in subjects)
                            ChartSeries(
                              label: s.subject,
                              color: colors.subjectColor(s.subject),
                              values: <double?>[
                                for (final ({String date, double? overall, Map<String, double?> bySubject}) r
                                    in trendRows)
                                  r.bySubject[s.subject],
                              ],
                            ),
                        ],
                      ),
                  ],
                  const SizedBox(height: 10),
                  if (hasSubjectScores) ...<Widget>[
                    RadarChart(
                      labels: <String>[
                        for (final ({String subject, double? average, int count}) s in subjects) s.subject
                      ],
                      values: <double>[
                        for (final ({String subject, double? average, int count}) s in subjects) s.average ?? 0,
                      ],
                    ),
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
                    ),
                  ] else
                    noData('Subject balance', 'Add scores to any subject test or mock to compare subjects.'),
                ],
              ],
            ),
          );
        case 'mistakes':
          return NotebookCard(
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
          );
        case 'study-hours':
          return NotebookCard(
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
          );
        case 'heatmap':
          return NotebookCard(
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
          );
        case 'syllabus':
          return NotebookCard(
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
          );
        case 'target':
          return NotebookCard(
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
          );
      }
      return const SizedBox.shrink();
    }

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
          WeeklyReportCard(data: data, today: today),
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
          if (pinned.isNotEmpty) ...<Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(2, 6, 2, 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text('Favourites', style: text.titleMedium),
                        Text(
                          'Your pinned charts stay at the top. Pin or unpin from any chart’s header — up to $pinLimit.',
                          style: muted,
                        ),
                      ],
                    ),
                  ),
                  Pill('${pinned.length}/$pinLimit pinned', dense: true),
                ],
              ),
            ),
            for (final String id in pinned) ...<Widget>[
              KeyedSubtree(key: ValueKey<String>('fav-$id'), child: cardFor(id)),
              const SizedBox(height: 10),
            ],
          ],
          cardFor('performance'),
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
          cardFor('mistakes'),
          const SizedBox(height: 10),
          cardFor('study-hours'),
          const SizedBox(height: 10),
          cardFor('heatmap'),
          const SizedBox(height: 10),
          cardFor('syllabus'),
          const SizedBox(height: 10),
          cardFor('target'),
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

/// The website's "Your week" card (WeeklyReportCard). Comparisons appear only when both
/// weeks have real data for the same subject.
class WeeklyReportCard extends StatelessWidget {
  const WeeklyReportCard({super.key, required this.data, required this.today});

  final AppData data;
  final String today;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final TextStyle? muted = text.bodySmall?.copyWith(color: colors.muted);
    final WeeklyReport report = buildWeeklyReport(data, today);
    Widget stat(String label, String value) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(label, style: text.labelSmall?.copyWith(color: colors.muted)),
            Text(value, style: text.titleMedium),
          ],
        );
    final String accuracy = report.practiceAccuracy == null ? '—' : '${jsRound(report.practiceAccuracy!)}%';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SectionHeading(
          'Your week',
          trailing: Text('${formatDate(report.start)} – ${formatDate(report.end)}', style: muted),
        ),
        NotebookCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              WrapGrid(
                minItemWidth: 120,
                children: <Widget>[
                  stat('Studied', _weekMinutes(report.studiedMinutes)),
                  stat('Lecture', _weekMinutes(report.activity.of('Lecture'))),
                  stat('Practice', _weekMinutes(report.activity.of('Practice'))),
                  stat('Revision', _weekMinutes(report.activity.of('Revision'))),
                  stat('Tests', '${report.testsLogged}'),
                  stat('Questions', indianGrouping(report.questionsAttempted)),
                  stat('Practice accuracy', accuracy),
                  stat('Active days', '${report.activeDays}/7'),
                ],
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: <Widget>[
                  Text('Strongest subject', style: text.labelMedium),
                  if (report.strongestSubject == null)
                    Text('not enough data yet', style: muted?.copyWith(fontStyle: FontStyle.italic))
                  else ...<Widget>[
                    Pill(report.strongestSubject!.subject, dense: true),
                    Text('${jsRound(report.strongestSubject!.value)}%', style: text.titleSmall),
                  ],
                ],
              ),
              const SizedBox(height: 4),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: <Widget>[
                  Text('Weakest area', style: text.labelMedium),
                  if (report.weakestArea == null)
                    Text('not enough data yet', style: muted?.copyWith(fontStyle: FontStyle.italic))
                  else ...<Widget>[
                    Text(report.weakestArea!.name, style: text.titleSmall),
                    Text('${report.weakestArea!.basis}, ${jsRound(report.weakestArea!.value)}%', style: muted),
                  ],
                ],
              ),
              const SizedBox(height: 8),
              if (report.comparisons.isNotEmpty)
                for (final String line in report.comparisons) Text('• $line', style: text.bodySmall)
              else
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Icon(Icons.date_range, size: 14, color: colors.muted),
                    const SizedBox(width: 5),
                    Expanded(child: Text(report.historyNote, style: muted)),
                  ],
                ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: colors.palette.accentLight,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Icon(Icons.lightbulb_outline, size: 16, color: colors.palette.textAccent),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text.rich(
                        TextSpan(children: <InlineSpan>[
                          const TextSpan(text: 'Next change: ', style: TextStyle(fontWeight: FontWeight.w700)),
                          TextSpan(text: report.actionable),
                        ]),
                        style: text.bodySmall,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// toLocaleString('en-IN') for whole numbers: 1,23,456.
String indianGrouping(int value) {
  final String digits = value.abs().toString();
  if (digits.length <= 3) return value.toString();
  final String last = digits.substring(digits.length - 3);
  String rest = digits.substring(0, digits.length - 3);
  final List<String> groups = <String>[];
  while (rest.length > 2) {
    groups.insert(0, rest.substring(rest.length - 2));
    rest = rest.substring(0, rest.length - 2);
  }
  if (rest.isNotEmpty) groups.insert(0, rest);
  return '${value < 0 ? '-' : ''}${groups.join(',')},$last';
}

/// The website's jee/shared minutesLabel: "2h 05m", "45m".
String _weekMinutes(int minutes) {
  final int safe = minutes < 0 ? 0 : minutes;
  final int hours = safe ~/ 60;
  final int mins = safe % 60;
  return hours > 0 ? '${hours}h ${mins.toString().padLeft(2, '0')}m' : '${mins}m';
}
