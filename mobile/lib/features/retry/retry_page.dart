import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../mistakes/mistakes_page.dart' show deleteMistakeWithConfirm, mistakeTypes;
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// Retry list, as on the website: mistakes marked "retry later" that are still pending.
/// "Mark retried" closes one (retry_status `retried`); "Keep for later" moves it back to
/// the notebook. The database only knows `pending` and `retried`.
class RetryPage extends ConsumerStatefulWidget {
  const RetryPage({super.key});

  @override
  ConsumerState<RetryPage> createState() => _RetryPageState();
}

class _RetryPageState extends ConsumerState<RetryPage> {
  final TextEditingController _search = TextEditingController();
  String? _subject;
  String? _chapterId;
  String? _type;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final List<Mistake> ready = data.mistakes.where((Mistake m) => m.retryLater && m.retryStatus == 'pending').toList();
    final String term = _search.text.trim().toLowerCase();
    final List<Mistake> rows = ready.where((Mistake mistake) {
      final Chapter? chapter = data.chapter(mistake.chapterId);
      if (_subject != null && chapter?.subject != _subject) return false;
      if (_chapterId != null && mistake.chapterId != _chapterId) return false;
      if (_type != null && mistake.mistakeType != _type) return false;
      if (term.isNotEmpty && !'${mistake.questionNote} ${chapter?.name ?? ''}'.toLowerCase().contains(term)) {
        return false;
      }
      return true;
    }).toList()
      ..sort((Mistake a, Mistake b) => a.createdAt.compareTo(b.createdAt));
    final List<Chapter> chapters = data.chapters
        .where((Chapter c) => _subject == null || c.subject == _subject)
        .toList()
      ..sort((Chapter a, Chapter b) => a.name.compareTo(b.name));

    return SectionPage(
      title: 'Retry list',
      subtitle: 'Try again before reading the solution. Retrieval beats recognition.',
      actions: <Widget>[
        IconButton(
          tooltip: 'Mistake notebook',
          icon: const Icon(Icons.menu_book_outlined, size: 21),
          onPressed: () => Routes.open(context, Routes.mistakes),
        ),
      ],
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          NotebookCard(
            child: Row(
              children: <Widget>[
                Icon(Icons.replay, color: colors.palette.accentDark),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'A SECOND LOOK',
                        style:
                            Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted, letterSpacing: 1.2),
                      ),
                      Text(
                        '${ready.length} question${ready.length == 1 ? '' : 's'} waiting for you',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          SearchBox(controller: _search, hint: 'Search retry notes…', onChanged: (_) => setState(() {})),
          const SizedBox(height: 8),
          AppSelect<String?>(
            label: 'Subject',
            value: _subject,
            items: <String?>[null, ...data.subjects],
            labelFor: (String? value) => value ?? 'All subjects',
            onChanged: (String? value) => setState(() {
              _subject = value;
              _chapterId = null;
            }),
          ),
          Row(
            children: <Widget>[
              Expanded(
                child: AppSelect<String?>(
                  label: 'Chapter',
                  value: chapters.any((Chapter c) => c.id == _chapterId) ? _chapterId : null,
                  items: <String?>[null, ...chapters.map((Chapter c) => c.id)],
                  labelFor: (String? id) => id == null ? 'All chapters' : data.chapterName(id),
                  onChanged: (String? value) => setState(() => _chapterId = value),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppSelect<String?>(
                  label: 'Type',
                  value: _type,
                  items: <String?>[null, ...mistakeTypes],
                  labelFor: (String? value) => value ?? 'All types',
                  onChanged: (String? value) => setState(() => _type = value),
                ),
              ),
            ],
          ),
          if (rows.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: ready.isEmpty ? 'Nothing waiting to retry.' : 'Nothing in this view.',
                message: ready.isEmpty ? 'Mark a mistake “Retry later” to add it here.' : null,
                icon: Icons.check_circle_outline,
                action: ready.isEmpty
                    ? OutlinedButton(
                        onPressed: () => Routes.open(context, Routes.mistakes),
                        child: const Text('Open mistake notebook'),
                      )
                    : OutlinedButton(
                        onPressed: () => setState(() {
                          _search.clear();
                          _subject = null;
                          _chapterId = null;
                          _type = null;
                        }),
                        child: const Text('Clear filters'),
                      ),
              ),
            )
          else
            for (final Mistake mistake in rows) _RetryTile(mistake: mistake, data: data),
          const SizedBox(height: 6),
          Text(
            'A question marked Retried stays in your mistake notebook for future review.',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
          ),
        ],
      ),
    );
  }
}

class _RetryTile extends ConsumerStatefulWidget {
  const _RetryTile({required this.mistake, required this.data});

  final Mistake mistake;
  final AppData data;

  @override
  ConsumerState<_RetryTile> createState() => _RetryTileState();
}

class _RetryTileState extends ConsumerState<_RetryTile> {
  bool _revealed = false;

  @override
  Widget build(BuildContext context) {
    final Mistake mistake = widget.mistake;
    final Chapter? chapter = widget.data.chapter(mistake.chapterId);
    final TestRecord? test = widget.data.tests.where((TestRecord t) => t.id == mistake.testId).firstOrNull;
    final StrackerColors colors = context.stracker;
    final TextStyle? meta = Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: NotebookCard(
        dense: true,
        accent: chapter == null ? null : colors.subjectColor(chapter.subject),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: chapter == null
                      ? const Align(
                          alignment: Alignment.centerLeft,
                          child: Pill('Chapter removed', tone: PillTone.bad, dense: true),
                        )
                      : Text(
                          '${chapter.subject} · ${chapter.name}',
                          style: Theme.of(context).textTheme.labelMedium,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                ),
                Pill(mistake.mistakeType, tone: PillTone.warn, dense: true),
              ],
            ),
            const SizedBox(height: 6),
            Text(mistake.questionNote, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 4),
            Text(
              <String>[
                'Added ${formatDate(mistake.createdAt.length >= 10 ? mistake.createdAt.substring(0, 10) : mistake.createdAt)}',
                if (test != null) 'Original test: ${test.title}',
              ].join(' · '),
              style: meta,
            ),
            if (_revealed)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  mistake.solutionNote.trim().isNotEmpty
                      ? mistake.solutionNote
                      : 'No note saved for this one yet. Edit it in Mistakes to add what you’ll remember.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.inkSoft,
                        fontStyle: mistake.solutionNote.trim().isEmpty ? FontStyle.italic : null,
                      ),
                ),
              )
            else
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => setState(() => _revealed = true),
                  child: const Text('Reveal my note'),
                ),
              ),
            Wrap(
              spacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                FilledButton.icon(
                  onPressed: () => _update(
                    mistake.copyWith(retryLater: false, retryStatus: 'retried'),
                    'Marked retried — that’s how a slip turns into recall.',
                  ),
                  icon: const Icon(Icons.check, size: 16),
                  label: const Text('Mark retried'),
                ),
                TextButton(
                  onPressed: () => _update(
                    mistake.copyWith(retryLater: false, retryStatus: 'pending'),
                    'Moved back to the notebook. You can add it to retry again later.',
                  ),
                  child: const Text('Keep for later'),
                ),
                IconButton(
                  tooltip: 'Delete question',
                  icon: const Icon(Icons.delete_outline, size: 19),
                  onPressed: () => deleteMistakeWithConfirm(
                    context,
                    ref,
                    mistake,
                    message: 'This mistake note will be removed.',
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _update(Mistake next, String message) async {
    try {
      await ref.read(dataControllerProvider.notifier).saveMistake(next);
      if (mounted) showToast(context, message);
      await HapticFeedback.lightImpact();
    } catch (error) {
      if (mounted) showToast(context, error.toString(), error: true);
    }
  }
}
