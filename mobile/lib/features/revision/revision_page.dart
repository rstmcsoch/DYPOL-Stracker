import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/progress.dart';
import '../../logic/revision.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';
import 'revision_actions.dart';

/// Revision planner: overdue, today, upcoming and recently completed revisions, plus
/// chapters that are finished but not yet on the ladder.
class RevisionPage extends ConsumerWidget {
  const RevisionPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final String today = todayIso();
    final RevisionBuckets buckets = revisionBuckets(data, today: today);
    final List<Chapter> unscheduled = chaptersWithoutRevision(data);
    final StrackerColors colors = context.stracker;

    return SectionPage(
      title: 'Revisions',
      subtitle: '${buckets.overdue.length} overdue · ${buckets.today.length} due today · '
          '${buckets.upcoming.length} upcoming',
      actions: <Widget>[
        IconButton(
          tooltip: 'Revision settings',
          icon: const Icon(Icons.tune, size: 20),
          onPressed: () => Routes.open(context, Routes.settings),
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _pickChapter(context, ref, data, unscheduled.isEmpty ? const <Chapter>[] : unscheduled),
        backgroundColor: colors.palette.accentDark,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_task, size: 19),
        label: const Text('Schedule'),
      ),
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          InfoBanner(
            'Your ladder: ${revisionGapLabel(data.settings.revisionGaps)}. Completing a revision '
            'schedules the next one using the gaps in Settings → Study rhythm.',
          ),
          const SizedBox(height: 10),
          if (buckets.isEmpty && unscheduled.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: 'Nothing scheduled',
                message: 'Finish a chapter, then schedule its first revision. The ladder does the rest.',
                icon: Icons.alarm_outlined,
                action: ElevatedButton(
                  onPressed: () => Routes.open(context, Routes.syllabus),
                  child: const Text('Open syllabus'),
                ),
              ),
            ),
          if (buckets.overdue.isNotEmpty) ...<Widget>[
            const SectionHeading('Overdue'),
            for (final Revision revision in buckets.overdue)
              RevisionTile(revision: revision, data: data),
          ],
          if (buckets.today.isNotEmpty) ...<Widget>[
            const SectionHeading('Due today'),
            for (final Revision revision in buckets.today)
              RevisionTile(revision: revision, data: data),
          ],
          if (buckets.upcoming.isNotEmpty) ...<Widget>[
            const SectionHeading('Upcoming'),
            for (final Revision revision in buckets.upcoming.take(30))
              RevisionTile(revision: revision, data: data),
          ],
          if (unscheduled.isNotEmpty) ...<Widget>[
            const SectionHeading('Finished but not scheduled'),
            NotebookCard(
              child: Column(
                children: <Widget>[
                  for (final Chapter chapter in unscheduled.take(12))
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text(chapter.name, style: Theme.of(context).textTheme.titleSmall),
                      subtitle: Text(
                        '${chapter.subject} · ${chapter.status} · '
                        '${completedStageCount(data, chapter)}/5 stages',
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                      trailing: TextButton(
                        onPressed: () => scheduleRevision(context, ref, data, chapter),
                        child: const Text('Schedule'),
                      ),
                    ),
                ],
              ),
            ),
          ],
          if (buckets.completedRecently.isNotEmpty) ...<Widget>[
            const SectionHeading('Completed in the last 14 days'),
            NotebookCard(
              child: Column(
                children: <Widget>[
                  for (final Revision revision in buckets.completedRecently.take(12))
                    RevisionTile(revision: revision, data: data),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Revision gaps',
            subtitle: 'Stored in app_settings.revision_gaps and shared with the website.',
            child: Text(
              revisionGapLabel(data.settings.revisionGaps),
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: colors.palette.textAccent),
            ),
          ),
        ],
      ),
    );
  }

  void _pickChapter(BuildContext context, WidgetRef ref, AppData data, List<Chapter> candidates) {
    final List<Chapter> options = candidates.isNotEmpty
        ? candidates
        : data.chapters.where((Chapter chapter) => chapter.isComplete).toList();
    showAppSheet<void>(
      context,
      title: 'Schedule a revision',
      builder: (BuildContext sheetContext) => options.isEmpty
          ? const EmptyState(
              title: 'No finished chapters yet',
              message: 'Mark a chapter Done or Revised in the syllabus first.',
              icon: Icons.menu_book_outlined,
            )
          : Column(
              children: <Widget>[
                for (final Chapter chapter in options)
                  ListTile(
                    title: Text(chapter.name),
                    subtitle: Text(
                      '${chapter.subject} · ${completedStageCount(data, chapter)}/5 stages · '
                      '${chapter.status}',
                      style: Theme.of(sheetContext).textTheme.labelSmall,
                    ),
                    trailing: const Icon(Icons.add, size: 18),
                    onTap: () async {
                      Navigator.of(sheetContext).pop();
                      await scheduleRevision(context, ref, data, chapter);
                    },
                  ),
              ],
            ),
    );
  }
}
