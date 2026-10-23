import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/revision.dart';

/// Marks a revision complete and schedules the next rung of the ladder.
/// Shared by the dashboard and the revision page so both write the same rows.
Future<void> completeRevision(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  Revision revision,
) async {
  final DataController controller = ref.read(dataControllerProvider.notifier);
  final Revision completed = revision.copyWith(completedAt: isoNow());
  final Revision? next = nextRevision(data: data, completed: completed);
  final Chapter? chapter = data.chapter(revision.chapterId);
  try {
    await controller.saveRevisions(<Revision>[
      completed,
      if (next != null) next,
    ]);
    if (chapter != null && chapter.status != 'Revised' && chapter.isComplete) {
      await controller.saveChapter(chapter.copyWith(status: 'Revised'));
    }
    if (context.mounted) {
      showToast(
        context,
        next == null
            ? 'Revision complete. That was the last rung in your ladder.'
            : 'Revision complete. Next one on ${formatDate(next.dueOn)}.',
      );
    }
  } catch (error) {
    if (context.mounted) showToast(context, error.toString(), error: true);
  }
}

/// Puts a chapter on the revision ladder (used from the syllabus and revision pages).
Future<void> scheduleRevision(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  Chapter chapter,
) async {
  final bool exists = data.revisions.any((Revision revision) =>
      revision.chapterId == chapter.id && revision.completedAt == null);
  if (exists) {
    if (context.mounted) showToast(context, 'That chapter already has a revision scheduled.');
    return;
  }
  try {
    await ref.read(dataControllerProvider.notifier).saveRevision(startRevisionChain(data, chapter.id));
    if (context.mounted) {
      showToast(context, 'Revision scheduled for ${chapter.name}.');
    }
  } catch (error) {
    if (context.mounted) showToast(context, error.toString(), error: true);
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
                  ),
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
          if (!done)
            TextButton(
              onPressed: () => completeRevision(context, ref, data, revision),
              child: const Text('Done'),
            )
          else
            Icon(Icons.check_circle, size: 18, color: colors.palette.green),
        ],
      ),
    );
  }
}
