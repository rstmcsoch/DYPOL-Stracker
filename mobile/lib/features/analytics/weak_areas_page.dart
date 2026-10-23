import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/analytics.dart';
import '../../logic/progress.dart';
import '../revision/revision_actions.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// Weak areas: chapters below the account's own weak threshold, chapters that are
/// dropping, and chapters with no evidence at all. Thresholds live in Settings and are
/// shared with the website.
class WeakAreasPage extends ConsumerWidget {
  const WeakAreasPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final List<ChapterPerformance> weak = weakChapters(data);
    final List<ChapterPerformance> dropping = chapterPerformance(data)
        .where((ChapterPerformance item) => item.dropping)
        .toList();
    final List<ChapterPerformance> untested = untestedChapters(data);
    final Map<String, PracticeAggregate> practice = practiceByChapter(data);
    final List<Chapter> weakByPractice = data.chapters.where((Chapter chapter) {
      final PracticeAggregate? aggregate = practice[chapter.id];
      return aggregate != null &&
          aggregate.attempted >= practiceMinAttemptsForSignal &&
          (aggregate.accuracy ?? 100) < data.settings.weakThreshold;
    }).toList();

    return SectionPage(
      title: 'Weak areas',
      subtitle: 'Weak under ${numberLabel(data.settings.weakThreshold)}% · '
          'strong at ${numberLabel(data.settings.strongThreshold)}%',
      actions: <Widget>[
        IconButton(
          tooltip: 'Change thresholds',
          icon: const Icon(Icons.tune, size: 20),
          onPressed: () => Routes.open(context, Routes.settings),
        ),
      ],
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          InfoBanner(
            'Classification uses your own thresholds. A chapter needs a valid test score to be '
            'classified; practice accuracy needs at least $practiceMinAttemptsForSignal questions '
            'before it counts as a signal.',
          ),
          const SizedBox(height: 10),
          if (weak.isEmpty && dropping.isEmpty && weakByPractice.isEmpty && untested.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: 'Nothing looks weak yet',
                message: 'Log tests that name a chapter, or practice blocks per chapter. '
                    'The list stays empty until there is evidence.',
                icon: Icons.emoji_objects_outlined,
                action: ElevatedButton(
                  onPressed: () => Routes.open(context, Routes.tests),
                  child: const Text('Open tests'),
                ),
              ),
            ),
          if (weak.isNotEmpty) ...<Widget>[
            SectionHeading('Below ${numberLabel(data.settings.weakThreshold)}%'),
            for (final ChapterPerformance item in weak)
              _WeakCard(
                chapter: item.chapter,
                percentage: item.average,
                caption: '${item.chapter.subject} · ${item.results.length} test'
                    '${item.results.length == 1 ? '' : 's'} · latest ${percentLabel(item.latest)}',
                data: data,
              ),
          ],
          if (dropping.isNotEmpty) ...<Widget>[
            SectionHeading('Dropping'),
            for (final ChapterPerformance item in dropping)
              _WeakCard(
                chapter: item.chapter,
                percentage: item.average,
                caption: 'Latest ${percentLabel(item.latest)} is at least '
                    '${numberLabel(data.settings.droppingThreshold)} points below the previous result.',
                data: data,
              ),
          ],
          if (weakByPractice.isNotEmpty) ...<Widget>[
            SectionHeading('Weak in practice'),
            for (final Chapter chapter in weakByPractice)
              _WeakCard(
                chapter: chapter,
                percentage: practice[chapter.id]?.accuracy,
                caption: '${practice[chapter.id]?.correct}/${practice[chapter.id]?.attempted} '
                    'correct in practice · no test needed',
                data: data,
              ),
          ],
          if (untested.isNotEmpty) ...<Widget>[
            SectionHeading('No evidence yet'),
            NotebookCard(
              subtitle: 'Chapters without a test score or a practice block with enough questions.',
              child: Column(
                children: <Widget>[
                  for (final ChapterPerformance item in untested.take(10))
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text(item.chapter.name),
                      subtitle: Text(
                        '${item.chapter.subject} · ${item.chapter.status}',
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                      trailing: TextButton(
                        onPressed: () => Routes.open(context, Routes.practice),
                        child: const Text('Practise'),
                      ),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),
          Text(
            'Thresholds are stored in app_settings, so changing them here changes the website too.',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
          ),
        ],
      ),
    );
  }
}

class _WeakCard extends ConsumerWidget {
  const _WeakCard({
    required this.chapter,
    required this.percentage,
    required this.caption,
    required this.data,
  });

  final Chapter chapter;
  final double? percentage;
  final String caption;
  final AppData data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: NotebookCard(
        dense: true,
        accent: colors.palette.red,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(chapter.name, style: Theme.of(context).textTheme.titleSmall),
                ),
                Text(
                  percentLabel(percentage),
                  style: TextStyle(fontFamily: 'PatrickHand', fontSize: 20, color: colors.palette.red),
                ),
              ],
            ),
            const SizedBox(height: 3),
            Text(caption, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted)),
            const SizedBox(height: 6),
            LinearBar(value: (percentage ?? 0) / 100, height: 5, color: colors.palette.red),
            const SizedBox(height: 6),
            Row(
              children: <Widget>[
                TextButton.icon(
                  onPressed: () => Routes.open(context, Routes.practice),
                  icon: const Icon(Icons.edit_note, size: 16),
                  label: const Text('Log practice'),
                ),
                TextButton.icon(
                  onPressed: () => scheduleRevision(context, ref, data, chapter),
                  icon: const Icon(Icons.alarm_add, size: 16),
                  label: const Text('Revise'),
                ),
                const Spacer(),
                IconButton(
                  tooltip: 'Open chapter',
                  icon: const Icon(Icons.chevron_right, size: 18),
                  onPressed: () => Routes.open(context, Routes.syllabus),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
