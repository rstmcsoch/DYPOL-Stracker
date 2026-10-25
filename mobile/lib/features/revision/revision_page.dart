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
class RevisionPage extends ConsumerStatefulWidget {
  const RevisionPage({super.key});

  @override
  ConsumerState<RevisionPage> createState() => _RevisionPageState();
}

/// The website's Revision desk: Overdue (oldest first), Due today, Tomorrow, Coming up
/// (first ten) and a Recently completed record, plus the app's own "finished but not
/// scheduled" shortcut.
class _RevisionPageState extends ConsumerState<RevisionPage> {
  bool _showCompleted = false;

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final String today = todayIso();
    final String tomorrow = addDays(today, 1);
    final List<Revision> open = data.revisions.where((Revision r) => r.completedAt == null).toList()
      ..sort((Revision a, Revision b) => a.dueOn.compareTo(b.dueOn));
    final List<Revision> overdue = open.where((Revision r) => r.dueOn.compareTo(today) < 0).toList();
    final List<Revision> dueToday = open.where((Revision r) => r.dueOn == today).toList();
    final List<Revision> dueTomorrow = open.where((Revision r) => r.dueOn == tomorrow).toList();
    final List<Revision> upcoming = open.where((Revision r) => r.dueOn.compareTo(tomorrow) > 0).toList();
    final List<Revision> completed = data.revisions.where((Revision r) => r.completedAt != null).toList()
      ..sort((Revision a, Revision b) => (b.completedAt ?? '').compareTo(a.completedAt ?? ''));
    final List<Revision> recent = completed.take(30).toList();
    final List<Chapter> unscheduled = chaptersWithoutRevision(data);
    final StrackerColors colors = context.stracker;
    final int attention = overdue.length + dueToday.length;

    Widget section(String title, String note, List<Revision> items, String empty, {int? limit, bool late = false}) {
      final List<Revision> visible = limit == null ? items : items.take(limit).toList();
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          SectionHeading(title,
              trailing: Pill('${items.length}', tone: late ? PillTone.bad : PillTone.neutral, dense: true)),
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(note, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted)),
          ),
          NotebookCard(
            dense: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                if (visible.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child:
                        Text('✳  $empty', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted)),
                  )
                else
                  for (final Revision revision in visible) RevisionTile(revision: revision, data: data),
                if (limit != null && items.length > limit)
                  Text(
                    'And ${items.length - limit} more scheduled.',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                  ),
              ],
            ),
          ),
        ],
      );
    }

    return SectionPage(
      title: 'Revision desk',
      subtitle: '$attention need attention',
      actions: <Widget>[
        IconButton(
          tooltip: 'Revision settings',
          icon: const Icon(Icons.tune, size: 20),
          onPressed: () => Routes.open(context, Routes.settings),
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'revision-schedule',
        onPressed: () => _pickChapter(context, ref, data, unscheduled),
        backgroundColor: colors.palette.accentDark,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_task, size: 19),
        label: const Text('Schedule'),
      ),
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          const RevisionFollowUpBanner(),
          NotebookCard(
            dense: true,
            child: Row(
              children: <Widget>[
                Icon(Icons.alarm, size: 18, color: attention > 0 ? colors.palette.red : colors.palette.accentDark),
                const SizedBox(width: 8),
                Text('$attention', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(width: 6),
                const Expanded(child: Text('need attention')),
                Flexible(
                  child: Text(
                    'Ladder ${revisionGapLabel(data.settings.revisionGaps)}',
                    textAlign: TextAlign.end,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                  ),
                ),
              ],
            ),
          ),
          if (overdue.isNotEmpty) section('Overdue', 'Oldest first.', overdue, 'You’re all caught up.', late: true),
          section(
            'Due today',
            dueToday.isNotEmpty
                ? '${dueToday.length} ready for a quick recall pass.'
                : 'Nothing due today. Keep progressing.',
            dueToday,
            'Nothing due today.',
          ),
          section('Tomorrow', 'A little peek at what’s coming.', dueTomorrow, 'No revision due tomorrow.'),
          section('Coming up', 'Scheduled next.', upcoming, 'No upcoming revisions scheduled.', limit: 10),
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
          const SizedBox(height: 10),
          NotebookCard(
            dense: true,
            onTap: () => setState(() => _showCompleted = !_showCompleted),
            child: Row(
              children: <Widget>[
                Icon(Icons.done_all, size: 18, color: colors.palette.green),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text('Recently completed', style: Theme.of(context).textTheme.titleSmall),
                      Text(
                        '${completed.length} revision${completed.length == 1 ? '' : 's'} in your record',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                      ),
                    ],
                  ),
                ),
                Text(_showCompleted ? 'Hide ↑' : 'Show ↓', style: TextStyle(color: colors.palette.textAccent)),
              ],
            ),
          ),
          if (_showCompleted) ...<Widget>[
            const SizedBox(height: 8),
            NotebookCard(
              dense: true,
              child: recent.isEmpty
                  ? const EmptyState(title: 'No finished revisions yet.', icon: Icons.done_all)
                  : Column(
                      children: <Widget>[
                        for (final Revision revision in recent) RevisionTile(revision: revision, data: data),
                      ],
                    ),
            ),
          ],
        ],
      ),
    );
  }

  void _pickChapter(BuildContext context, WidgetRef ref, AppData data, List<Chapter> candidates) {
    final List<Chapter> options =
        candidates.isNotEmpty ? candidates : data.chapters.where((Chapter chapter) => chapter.isComplete).toList();
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
