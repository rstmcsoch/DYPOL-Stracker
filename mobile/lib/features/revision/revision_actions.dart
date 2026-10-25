import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/errors.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/buttons.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/revision.dart';

/// Marks a revision complete and schedules the next rung of the ladder.
/// Shared by the dashboard and the revision page so both write the same rows.
/// Revisions being saved right now: a double tap cannot schedule the next rung twice.
final Set<String> _completing = <String>{};

/// Chapters whose first revision is being scheduled right now (double-tap guard).
final Set<String> _scheduling = <String>{};

Future<void> completeRevision(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  Revision revision,
) async {
  if (!_completing.add(revision.id)) return;
  final DataController controller = ref.read(dataControllerProvider.notifier);
  final Revision completed = revision.copyWith(completedAt: isoNow());
  final Revision? next = nextRevision(data: data, completed: completed);
  final Chapter? chapter = data.chapter(revision.chapterId);
  try {
    await controller.saveRevisions(<Revision>[
      completed,
      if (next != null) next,
    ]);
    if (chapter != null && chapter.status == 'Done') {
      await controller.saveChapter(chapter.copyWith(status: 'Revised'));
    }
    if (context.mounted) {
      showToast(
        context,
        next == null
            ? 'Revision done. Your memory just got a little stronger.'
            : 'Revision done. Your memory just got a little stronger. Next one on ${formatDate(next.dueOn)}.',
      );
    }
    await HapticFeedback.lightImpact();
  } catch (error) {
    if (context.mounted) showToast(context, userMessage(error), error: true);
  } finally {
    _completing.remove(revision.id);
  }
}

/// The website's "+1d": moves an open revision to tomorrow without completing it.
Future<void> snoozeRevision(BuildContext context, WidgetRef ref, Revision revision) async {
  try {
    await ref.read(dataControllerProvider.notifier).saveRevision(revision.copyWith(dueOn: addDays(todayIso(), 1)));
    if (context.mounted) showToast(context, 'Moved to tomorrow. It is still in your queue.');
    await HapticFeedback.selectionClick();
  } catch (error) {
    if (context.mounted) showToast(context, userMessage(error), error: true);
  }
}

/// Puts a chapter on the revision ladder (used from the syllabus and revision pages).
Future<void> scheduleRevision(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  Chapter chapter,
) async {
  // Read the live data, not the caller's snapshot: an open sheet's snapshot misses a
  // revision that was just scheduled from it.
  final AppData live = ref.read(dataControllerProvider).data;
  final bool exists =
      live.revisions.any((Revision revision) => revision.chapterId == chapter.id && revision.completedAt == null);
  if (exists || _scheduling.contains(chapter.id)) {
    if (context.mounted) showToast(context, 'That chapter already has a revision scheduled.');
    return;
  }
  _scheduling.add(chapter.id);
  try {
    await ref.read(dataControllerProvider.notifier).saveRevision(startRevisionChain(live, chapter.id));
    if (context.mounted) {
      showToast(context, 'Revision scheduled for ${chapter.name}.');
    }
  } catch (error) {
    if (context.mounted) showToast(context, userMessage(error), error: true);
  } finally {
    _scheduling.remove(chapter.id);
  }
}

/// A compact revision row reused across screens.
class RevisionTile extends ConsumerWidget {
  const RevisionTile({super.key, required this.revision, required this.data, this.showChapter = true});

  final Revision revision;
  final AppData data;
  final bool showChapter;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final Chapter? chapter = data.chapter(revision.chapterId);
    final bool overdue = isPast(revision.dueOn);
    final bool done = revision.completedAt != null;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.palette.paperSoft,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: colors.palette.line),
      ),
      child: Row(
        children: <Widget>[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: done
                  ? colors.palette.greenBg
                  : overdue
                      ? colors.palette.redBg
                      : colors.palette.accentLight,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              'R${revision.revisionNumber}',
              style: TextStyle(
                fontFamily: 'PatrickHand',
                fontSize: 14,
                color: done
                    ? colors.palette.green
                    : overdue
                        ? colors.palette.red
                        : colors.palette.textAccent,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (showChapter)
                  Text(
                    chapter?.name ?? 'Chapter',
                    style: Theme.of(context).textTheme.titleSmall,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                if (showChapter && chapter != null)
                  Text(chapter.subject, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted)),
                Text(
                  done
                      ? 'Completed ${formatDateTime(revision.completedAt)}'
                      : '${formatDate(revision.dueOn)} · ${dueLabel(revision.dueOn)}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: done
                            ? colors.palette.green
                            : overdue
                                ? colors.palette.red
                                : colors.muted,
                      ),
                ),
              ],
            ),
          ),
          if (!done) ...<Widget>[
            IconButton(
              tooltip: 'Move to tomorrow',
              visualDensity: VisualDensity.compact,
              onPressed: () => snoozeRevision(context, ref, revision),
              icon: Text('+1d', style: TextStyle(fontSize: 12, color: colors.inkSoft, fontWeight: FontWeight.w600)),
            ),
            FilledButton.icon(
              style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
              onPressed: () => completeRevision(context, ref, data, revision),
              icon: const Icon(Icons.check, size: 15),
              label: const Text('Revised'),
            ),
          ] else
            Icon(Icons.check_circle, size: 18, color: colors.palette.green),
        ],
      ),
    );
  }
}

/// Shown while a chapter's revision dates are waiting to be saved (the chapter itself was
/// saved). Retry writes them now; Dismiss drops them (revisions can be scheduled by hand).
class RevisionFollowUpBanner extends ConsumerWidget {
  const RevisionFollowUpBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<RevisionFollowUp> jobs = ref.watch(dataControllerProvider.select((DataState s) => s.followUps));
    if (jobs.isEmpty) return const SizedBox.shrink();
    final String names = jobs.map((RevisionFollowUp job) => job.chapterName).where((String n) => n.isNotEmpty).join(', ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: NotebookCard(
        key: const ValueKey<String>('revision-followups'),
        title: 'Revision dates not saved yet',
        subtitle: '${names.isEmpty ? 'Some chapters' : names}: the chapter was saved but its revision dates '
            'could not reach Stracker. They retry automatically when you are back online.',
        child: Row(
          children: <Widget>[
            Expanded(
              child: SaveButton(
                label: 'Retry',
                onPressed: () async {
                  final String? error = await ref.read(dataControllerProvider.notifier).retryFollowUps();
                  if (!context.mounted) return;
                  showToast(context, error ?? 'Revision dates saved.', error: error != null);
                },
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: SecondaryButton(
                label: 'Dismiss',
                onPressed: () async {
                  final bool confirmed = await confirmAction(
                    context,
                    title: 'Drop these revision dates?',
                    message: 'The chapters stay saved. You can schedule their revisions by hand later.',
                    confirmLabel: 'Drop',
                  );
                  if (confirmed) ref.read(dataControllerProvider.notifier).dismissFollowUps();
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
