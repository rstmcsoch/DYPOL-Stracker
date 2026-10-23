import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/charts.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../logic/aggregation.dart';
import '../../logic/analytics.dart';
import '../../logic/progress.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// Analytics: the same maths as the website's analytics page — test averages that only
/// use valid scores, subject signals, chapter classification against your own
/// thresholds, study time split by activity, consistency and the mistake summary.
class AnalyticsPage extends ConsumerWidget {
  const AnalyticsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final String today = todayIso();
    final MeanResult mean = meanTestPercentage(data.tests, data.testSubjectScores);
    final List<SubjectSignal> signals = subjectSignals(data);
    final List<ChapterPerformance> chapters = chapterPerformance(data);
    final List<ChapterPerformance> weak = weakChapters(data);
    final List<TrendPoint> trend = testTrend(data);
    final StudyTotals totals = studyTotals(data, today: today);
    final MistakeSummary mistakes = mistakeSummary(data);
    final List<String> prompts = studyPrompts(data);

    return NotebookScaffold(
      title: 'Analytics',
      showBrand: true,
      actions: <Widget>[
        IconButton(
          tooltip: 'Exams and thresholds',
          icon: const Icon(Icons.tune, size: 20),
          onPressed: () => Routes.open(context, Routes.settings),
        ),
      ],
      body: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(child: Text('Analytics', style: Theme.of(context).textTheme.headlineLarge)),
              Pill('${mean.count} scores', tone: PillTone.neutral, dense: true),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Every figure comes from your records only. Thresholds: weak < ${numberLabel(data.settings.weakThreshold)}%, '
            'strong ≥ ${numberLabel(data.settings.strongThreshold)}%, dropping when the latest result falls '
            '${numberLabel(data.settings.droppingThreshold)} points or more.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
          ),
          const SizedBox(height: 12),
          NotebookCard(
            title: 'Overall average',
            subtitle: 'Mean of valid test percentages. Full Mocks count once, through their subject rows.',
            child: Row(
              children: <Widget>[
                ProgressRing(value: mean.average, size: 92),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(percentLabel(mean.average), style: Theme.of(context).textTheme.displaySmall),
                      Text(
                        mean.average == null
                            ? 'Log a test with marks and a total to start the average.'
                            : mean.average! >= data.settings.strongThreshold
                                ? 'At or above your strong threshold.'
                                : mean.average! < data.settings.weakThreshold
                                    ? 'Below your weak threshold — look at weak areas.'
                                    : 'Between your weak and strong thresholds.',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Trend',
            subtitle: trend.isEmpty ? 'No dated scores yet.' : '${trend.length} most recent results',
            child: trend.isEmpty
                ? Text(
                    'A trend line appears once you have at least one test with a valid percentage.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      LineSeriesChart(
                        points: <double>[for (final TrendPoint point in trend) point.percentage],
                        labels: <String>[for (final TrendPoint point in trend) point.date],
                      ),
                      const SizedBox(height: 8),
                      for (final TrendPoint point in trend.reversed.take(3))
                        Padding(
                          padding: const EdgeInsets.only(bottom: 3),
                          child: Row(
                            children: <Widget>[
                              Expanded(
                                child: Text(
                                  point.title,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.labelSmall,
                                ),
                              ),
                              Text(
                                '${point.date} · ${percentLabel(point.percentage)}',
                                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                      color: colors.muted,
                                    ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Subjects',
            subtitle: 'Test average and practice accuracy are kept separate, exactly like the website.',
            child: Column(
              children: <Widget>[
                for (final SubjectSignal signal in signals)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Row(
                          children: <Widget>[
                            Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                color: colors.subjectColor(signal.subject),
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 7),
                            Expanded(
                              child: Text(signal.subject, style: Theme.of(context).textTheme.titleSmall),
                            ),
                            Text(
                              signal.average == null ? '—' : percentLabel(signal.average),
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        LinearBar(
                          value: (signal.average ?? 0) / 100,
                          height: 6,
                          color: colors.subjectColor(signal.subject),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '${signal.tests} test${signal.tests == 1 ? '' : 's'} · '
                          'practice ${signal.practiceAccuracy == null ? '—' : percentLabel(signal.practiceAccuracy)} '
                          'over ${signal.practiceAttempts} questions'
                          '${signal.practiceAttempts > 0 && signal.practiceAttempts < practiceMinAttemptsForSignal ? ' (below the 20-question signal)' : ''}'
                          ' · ${signal.completed}/${signal.chapters} chapters',
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Chapter classification',
            subtitle: '${chapters.length} chapters with test evidence',
            trailing: TextButton(
              onPressed: () => Routes.open(context, Routes.weakAreas),
              child: const Text('Weak areas'),
            ),
            child: chapters.isEmpty
                ? Text(
                    'Link a chapter to a test to classify it.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                  )
                : BarList(
                    rows: <({String label, double value, String caption})>[
                      for (final ChapterPerformance item in chapters.take(14))
                        (
                          label: item.chapter.name,
                          value: (item.average ?? 0) / 100,
                          caption: '${percentLabel(item.average)} · ${item.classification}'
                              '${item.dropping ? ' · dropping' : ''}',
                        ),
                    ],
                    unit: '%',
                  ),
          ),
          if (weak.isNotEmpty) ...<Widget>[
            const SizedBox(height: 10),
            NotebookCard(
              title: 'Below your weak threshold',
              child: Column(
                children: <Widget>[
                  for (final ChapterPerformance item in weak.take(6))
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text(item.chapter.name),
                      subtitle: Text(
                        '${item.chapter.subject} · ${percentLabel(item.average)} average',
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                      trailing: Pill('Practise', tone: PillTone.warn, dense: true),
                      onTap: () => Routes.open(context, Routes.practice),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Study time by activity',
            subtitle: '${minutesLabel(totals.totalMinutes)} recorded in total',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                BarList(
                  rows: <({String label, double value, String caption})>[
                    for (final MapEntry<String, int> entry in totals.byActivity.entries)
                      (
                        label: entry.key,
                        value: totals.totalMinutes == 0 ? 0 : entry.value / totals.totalMinutes,
                        caption: minutesLabel(entry.value),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Text('Last 28 days', style: Theme.of(context).textTheme.labelMedium),
                const SizedBox(height: 6),
                ConsistencyStrip(days: consistencyStrip(data, today: today)),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Mistakes',
            subtitle: '${mistakes.total} logged · ${mistakes.pendingRetries} awaiting retry',
            trailing: TextButton(
              onPressed: () => Routes.open(context, Routes.mistakes),
              child: const Text('Notebook'),
            ),
            child: Column(
              children: <Widget>[
                for (final MapEntry<String, int> entry in mistakes.byType.entries)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Row(
                      children: <Widget>[
                        Expanded(child: Text(entry.key, style: Theme.of(context).textTheme.bodySmall)),
                        Text('${entry.value}', style: Theme.of(context).textTheme.titleSmall),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          if (prompts.isNotEmpty) ...<Widget>[
            const SizedBox(height: 10),
            NotebookCard(
              title: 'What the notebook notices',
              subtitle: 'Rule-based prompts, not predictions.',
              child: Column(
                children: <Widget>[
                  for (final String prompt in prompts.take(6))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Icon(Icons.auto_awesome, size: 14, color: colors.palette.accent),
                          const SizedBox(width: 7),
                          Expanded(
                            child: Text(prompt, style: Theme.of(context).textTheme.bodySmall),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => Routes.open(context, Routes.mockAnalysis),
            icon: const Icon(Icons.analytics_outlined, size: 18),
            label: const Text('Mock analysis'),
          ),
        ],
      ),
    );
  }
}
