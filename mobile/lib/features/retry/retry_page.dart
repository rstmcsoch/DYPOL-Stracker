import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/analytics.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// Retry queue: mistakes that asked to be retried, worked through as pending →
/// retrying → resolved. Re-attempting is what closes a mistake.
class RetryPage extends ConsumerWidget {
  const RetryPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final List<Mistake> pending =
        data.mistakes.where((Mistake m) => m.retryStatus == 'pending').toList()
          ..sort((Mistake a, Mistake b) => a.createdAt.compareTo(b.createdAt));
    final List<Mistake> retrying =
        data.mistakes.where((Mistake m) => m.retryStatus == 'retrying').toList();
    final List<Mistake> resolved =
        data.mistakes.where((Mistake m) => m.retryStatus == 'resolved').toList()
          ..sort((Mistake a, Mistake b) => b.updatedAt.compareTo(a.updatedAt));

    return SectionPage(
      title: 'Retry',
      subtitle: '${pending.length} pending · ${retrying.length} in progress · ${resolved.length} resolved',
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          InfoBanner(
            'Retry means re-attempting the question before looking at the solution. Marking a mistake '
            'resolved is your record — the notebook never assumes you got it right.',
            icon: Icons.replay,
          ),
          const SizedBox(height: 10),
          if (pending.isEmpty && retrying.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: 'The queue is clear',
                message: 'Mistakes marked “retry later” land here automatically. Log a mistake with the '
                    'retry switch on and it appears.',
                icon: Icons.done_all,
                action: ElevatedButton(
                  onPressed: () => Routes.open(context, Routes.mistakes),
                  child: const Text('Open mistake notebook'),
                ),
              ),
            ),
          if (retrying.isNotEmpty) ...<Widget>[
            const SectionHeading('In progress'),
            for (final Mistake mistake in retrying)
              _RetryTile(mistake: mistake, data: data, accent: colors.palette.orange),
          ],
          if (pending.isNotEmpty) ...<Widget>[
            const SectionHeading('Pending'),
            for (final Mistake mistake in pending) _RetryTile(mistake: mistake, data: data),
          ],
          if (resolved.isNotEmpty) ...<Widget>[
            const SectionHeading('Recently resolved'),
            NotebookCard(
              subtitle: 'Kept as evidence that the mistake was closed.',
              child: Column(
                children: <Widget>[
                  for (final Mistake mistake in resolved.take(8))
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      leading: Icon(Icons.check_circle, size: 18, color: colors.palette.green),
                      title: Text(
                        mistake.questionNote,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      subtitle: Text(
                        '${data.chapterName(mistake.chapterId)} · ${mistake.mistakeType}',
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                      trailing: TextButton(
                        onPressed: () => setRetryStatus(context, ref, mistake, 'pending'),
                        child: const Text('Reopen'),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

}

class _RetryTile extends ConsumerWidget {
  const _RetryTile({required this.mistake, required this.data, this.accent});

  final Mistake mistake;
  final AppData data;
  final Color? accent;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Chapter? chapter = data.chapter(mistake.chapterId);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: NotebookCard(
        dense: true,
        accent: accent,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Pill(mistake.mistakeType, tone: PillTone.warn, dense: true),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    chapter?.name ?? 'Chapter',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: context.stracker.muted,
                        ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(
                  '${mistake.retryStatus}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: context.stracker.palette.textAccent,
                      ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(mistake.questionNote, style: Theme.of(context).textTheme.bodyMedium),
            if (mistake.solutionNote.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  mistake.solutionNote,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: context.stracker.muted,
                      ),
                ),
              ),
            const SizedBox(height: 6),
            Row(
              children: <Widget>[
                if (mistake.retryStatus == 'pending')
                  FilledButton.tonal(
                    onPressed: () => setRetryStatus(context, ref, mistake, 'retrying'),
                    child: const Text('Start retry'),
                  ),
                const SizedBox(width: 6),
                OutlinedButton(
                  onPressed: () => setRetryStatus(context, ref, mistake, 'resolved'),
                  child: const Text('Resolve'),
                ),
                const Spacer(),
                if (mistake.imagePath != null)
                  const Icon(Icons.image_outlined, size: 16),
                Text(
                  ' · ${formatDate(mistake.createdAt)}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: context.stracker.muted,
                      ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}


/// One place that writes a retry status, used by the queue and the resolved list.
Future<void> setRetryStatus(
  BuildContext context,
  WidgetRef ref,
  Mistake mistake,
  String status,
) async {
  try {
    await ref.read(dataControllerProvider.notifier).saveMistake(mistake.copyWith(retryStatus: status));
    if (context.mounted) showToast(context, 'Retry status: $status.');
  } catch (error) {
    if (context.mounted) showToast(context, error.toString(), error: true);
  }
}
