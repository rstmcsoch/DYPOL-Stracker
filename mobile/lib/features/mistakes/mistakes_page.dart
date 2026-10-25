import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/date.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/analytics.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';
import '../../core/widgets/wandering_eyes.dart';

/// The five types the database accepts (web MISTAKE_TYPES).
const List<String> mistakeTypes = <String>['Concept', 'Silly', 'Calculation', 'Time', 'Guess'];

String _short(String text) => text.length > 48 ? '${text.substring(0, 48)}…' : text;

Future<void> deleteMistakeWithConfirm(BuildContext context, WidgetRef ref, Mistake mistake, {String? message}) async {
  final bool confirmed = await confirmAction(
    context,
    title: 'Delete “${_short(mistake.questionNote)}”?',
    message: message ?? 'The note and its attached image will be removed.',
  );
  if (!confirmed) return;
  try {
    await ref.read(dataControllerProvider.notifier).deleteMistake(mistake);
    if (context.mounted) showToast(context, 'Mistake entry deleted.');
  } catch (error) {
    if (context.mounted) showToast(context, error.toString(), error: true);
  }
}

class MistakesPage extends ConsumerStatefulWidget {
  const MistakesPage({super.key});

  @override
  ConsumerState<MistakesPage> createState() => _MistakesPageState();
}

class _MistakesPageState extends ConsumerState<MistakesPage> {
  final TextEditingController _search = TextEditingController();
  String _type = 'All';
  String? _subject;
  String _status = 'All';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final MistakeSummary summary = mistakeSummary(data);
    final String needle = _search.text.trim().toLowerCase();
    final List<Mistake> rows = data.mistakes.where((Mistake mistake) {
      final Chapter? chapter = data.chapter(mistake.chapterId);
      final bool matchesType = _type == 'All' || mistake.mistakeType == _type;
      final bool matchesSubject = _subject == null || chapter?.subject == _subject;
      final bool matchesStatus = switch (_status) {
        'Retry list' => mistake.retryLater && mistake.retryStatus == 'pending',
        'Retried' => mistake.retryStatus == 'retried',
        _ => true,
      };
      final bool matchesQuery = needle.isEmpty ||
          '${mistake.questionNote} ${mistake.solutionNote} ${mistake.mistakeType} ${chapter?.name ?? ''}'
              .toLowerCase()
              .contains(needle);
      return matchesType && matchesSubject && matchesStatus && matchesQuery;
    }).toList()
      ..sort((Mistake a, Mistake b) => b.createdAt.compareTo(a.createdAt));

    return SectionPage(
      title: 'Mistake notebook',
      subtitle: '${summary.total} notes · ${summary.pendingRetries} ready to retry',
      actions: <Widget>[
        IconButton(
          tooltip: 'Retry queue',
          icon: const Icon(Icons.replay, size: 21),
          onPressed: () => Routes.open(context, Routes.retry),
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => openMistakeEditor(context, ref, data, null),
        backgroundColor: colors.palette.accentDark,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add, size: 19),
        label: const Text('Add a mistake'),
      ),
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          WrapGrid(
            minItemWidth: 150,
            children: <Widget>[
              StatTile(value: '${data.mistakes.length}', label: 'notes in your notebook'),
              StatTile(
                value: '${summary.pendingRetries}',
                label: 'ready to retry',
                hint: 'Open the retry list',
                onTap: () => Routes.open(context, Routes.retry),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SearchBox(controller: _search, hint: 'Search question notes…', onChanged: (_) => setState(() {})),
          const SizedBox(height: 8),
          AppSelect<String?>(
            label: 'Subject',
            value: _subject,
            items: <String?>[null, ...data.subjects],
            labelFor: (String? value) => value ?? 'All subjects',
            onChanged: (String? value) => setState(() => _subject = value),
          ),
          Row(
            children: <Widget>[
              Expanded(
                child: AppSelect<String>(
                  label: 'Type',
                  value: _type,
                  items: <String>['All', ...mistakeTypes],
                  onChanged: (String? value) => setState(() => _type = value ?? 'All'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppSelect<String>(
                  label: 'Retry',
                  value: _status,
                  items: const <String>['All', 'Retry list', 'Retried'],
                  labelFor: (String value) => value == 'All' ? 'All notes' : value,
                  onChanged: (String? value) => setState(() => _status = value ?? 'All'),
                ),
              ),
            ],
          ),
          if (summary.byType.isNotEmpty)
            NotebookCard(
              title: 'By type',
              child: Column(
                children: <Widget>[
                  for (final MapEntry<String, int> entry in summary.byType.entries)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 3),
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
          const SizedBox(height: 10),
          if (rows.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: data.mistakes.isEmpty ? 'No mistakes logged yet.' : 'No notes match.',
                icon: Icons.book_outlined,
                action: data.mistakes.isEmpty
                    ? ElevatedButton(
                        onPressed: () => openMistakeEditor(context, ref, data, null),
                        child: const Text('Add your first note'),
                      )
                    : OutlinedButton(
                        onPressed: () => setState(() {
                          _search.clear();
                          _subject = null;
                          _type = 'All';
                          _status = 'All';
                        }),
                        child: const Text('Clear filters'),
                      ),
              ),
            )
          else
            for (final Mistake mistake in rows) _MistakeCard(mistake: mistake, data: data),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '${rows.length} note${rows.length == 1 ? '' : 's'} shown',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                ),
              ),
              TextButton.icon(
                onPressed: () => Routes.open(context, Routes.retry),
                icon: const Icon(Icons.north_east, size: 15),
                label: const Text('Go to retry list'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MistakeCard extends ConsumerWidget {
  const _MistakeCard({required this.mistake, required this.data});

  final Mistake mistake;
  final AppData data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final String? path = mistake.imagePath;
    final TestRecord? linkedTest = data.tests.where((TestRecord t) => t.id == mistake.testId).firstOrNull;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: NotebookCard(
        dense: true,
        onTap: () => openMistakeEditor(context, ref, data, mistake),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Pill(
                  mistake.mistakeType,
                  tone: PillTone.bad,
                  dense: true,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    data.chapterName(mistake.chapterId),
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(
                  formatDate(
                      mistake.createdAt.substring(0, mistake.createdAt.length < 10 ? mistake.createdAt.length : 10)),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                ),
                IconButton(
                  tooltip: 'Delete mistake note',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.delete_outline, size: 18),
                  onPressed: () => deleteMistakeWithConfirm(context, ref, mistake),
                ),
              ],
            ),
            if (linkedTest != null)
              Text(
                'From ${linkedTest.title}',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.inkSoft),
              ),
            const SizedBox(height: 6),
            Text(mistake.questionNote, style: Theme.of(context).textTheme.bodyMedium),
            if (mistake.solutionNote.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'WHAT I’LL REMEMBER',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted, letterSpacing: 1.1),
                    ),
                    Text(
                      mistake.solutionNote,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.inkSoft),
                    ),
                  ],
                ),
              ),
            if (path != null && path.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _MistakeImage(path: path),
              ),
            const SizedBox(height: 4),
            Row(
              children: <Widget>[
                if (mistake.retryStatus == 'retried')
                  const Pill('Retried', tone: PillTone.good, dense: true)
                else if (mistake.retryLater)
                  const Pill('Retry later', tone: PillTone.warn, dense: true)
                else
                  const Pill('Notebook', dense: true),
                const Spacer(),
                if (mistake.retryStatus == 'pending')
                  TextButton(
                    onPressed: () async {
                      final bool adding = !mistake.retryLater;
                      try {
                        await ref
                            .read(dataControllerProvider.notifier)
                            .saveMistake(mistake.copyWith(retryLater: adding));
                        if (context.mounted) {
                          showToast(context, adding ? 'Added to your retry list.' : 'Removed from the retry list.');
                        }
                        await HapticFeedback.selectionClick();
                      } catch (error) {
                        if (context.mounted) showToast(context, error.toString(), error: true);
                      }
                    },
                    child: Text(mistake.retryLater ? 'Keep in notes' : 'Retry later'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Loads a private object with a short-lived signed URL. Nothing is public.
class _MistakeImage extends ConsumerStatefulWidget {
  const _MistakeImage({required this.path});

  final String path;

  @override
  ConsumerState<_MistakeImage> createState() => _MistakeImageState();
}

class _MistakeImageState extends ConsumerState<_MistakeImage> {
  Uint8List? _bytes;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final Uint8List? bytes = await ref.read(dataControllerProvider.notifier).mistakeImageBytes(widget.path);
    if (!mounted) return;
    setState(() {
      _bytes = bytes;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const SizedBox(
        height: 90,
        child: Center(child: WanderingEyes(height: 20)),
      );
    }
    final Uint8List? bytes = _bytes;
    if (bytes == null) {
      return Text(
        'Image could not be loaded (it may have been removed).',
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: context.stracker.palette.red),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Image.memory(bytes, height: 160, fit: BoxFit.cover),
    );
  }
}

Future<void> openMistakeEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  Mistake? mistake,
) async {
  if (data.chapters.isEmpty) {
    showToast(context, 'Add a chapter in the syllabus first.', error: true);
    return;
  }
  final bool creating = mistake == null;
  final TextEditingController question = TextEditingController(text: mistake?.questionNote ?? '');
  final TextEditingController solution = TextEditingController(text: mistake?.solutionNote ?? '');
  String type = mistakeTypes.contains(mistake?.mistakeType) ? mistake!.mistakeType : 'Concept';
  String? subjectError;
  String? chapterError;
  String? chapterId = mistake?.chapterId;
  String? subject = data.chapter(chapterId)?.subject;
  final List<String> subjects =
      data.subjects.where((String name) => data.chapters.any((Chapter chapter) => chapter.subject == name)).toList();
  String? testId = mistake?.testId;
  bool retryLater = mistake?.retryLater ?? false;
  File? picked;
  String? error;

  await showAppSheet<void>(
    context,
    title: creating ? 'Save a learning moment' : 'Edit mistake note',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppSelect<String?>(
            label: 'Subject',
            error: subjectError,
            value: subject,
            items: <String?>[null, ...subjects],
            labelFor: (String? value) => value ?? 'Choose a subject',
            onChanged: (String? value) => setSheetState(() {
              if (value == subject) return;
              subject = value;
              chapterId = null;
              subjectError = null;
              chapterError = null;
            }),
          ),
          AppSelect<String?>(
            label: 'Chapter',
            value: chapterId,
            enabled: subject != null,
            items: <String?>[
              null,
              for (final Chapter chapter in data.chapters)
                if (chapter.subject == subject) chapter.id,
            ],
            labelFor: (String? id) =>
                id == null ? (subject == null ? 'Pick a subject first' : 'Choose a chapter') : data.chapterName(id),
            error: chapterError,
            onChanged: (String? value) => setSheetState(() {
              chapterId = value;
              chapterError = null;
            }),
          ),
          AppSelect<String>(
            label: 'Mistake type',
            value: type,
            items: mistakeTypes,
            onChanged: (String? value) => setSheetState(() => type = value ?? type),
          ),
          AppSelect<String?>(
            label: 'Related test',
            value: testId,
            items: <String?>[null, ...data.tests.map((TestRecord test) => test.id)],
            labelFor: (String? id) => id == null
                ? 'No linked test'
                : () {
                    final TestRecord test = data.tests.firstWhere((TestRecord test) => test.id == id);
                    return '${test.title} · ${formatDate(test.testDate)}';
                  }(),
            onChanged: (String? value) => setSheetState(() => testId = value),
          ),
          AppField(
            label: 'What was the question or mistake?',
            controller: question,
            maxLines: 4,
            maxLength: 10000,
            hint: 'Write enough to recognize the question next time…',
            required: true,
            error: error,
          ),
          AppField(
            label: 'Solution / what I’ll remember',
            controller: solution,
            maxLines: 3,
            maxLength: 10000,
            hint: 'The key idea, missed condition, or check to use next time…',
          ),
          SwitchRow(
            title: 'Put this on my retry list',
            subtitle: 'Bring it back for another attempt.',
            value: retryLater,
            onChanged: (bool value) => setSheetState(() => retryLater = value),
          ),
          OutlinedButton.icon(
            onPressed: () async {
              final XFile? file = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
              if (file == null) return;
              setSheetState(() {
                picked = File(file.path);
              });
            },
            icon: const Icon(Icons.image_outlined, size: 18),
            label: Text(
              picked == null
                  ? (creating ? 'Attach a question image' : 'Replace question image')
                  : 'Image selected · tap to change',
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Images stay private to your account.',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: context.stracker.muted),
          ),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: () async {
              final Chapter? chosen = data.chapter(chapterId);
              if (subject == null || chosen == null || chosen.subject != subject) {
                setSheetState(() {
                  if (subject == null) subjectError = 'Choose a subject first.';
                  chapterError = subject != null
                      ? 'Choose a chapter from the selected subject.'
                      : 'Choose a subject, then a chapter.';
                });
                showToast(context, 'Choose a subject and one of its chapters.', error: true);
                return;
              }
              if (question.text.trim().isEmpty) {
                setSheetState(() => error = 'Write the question or mistake.');
                showToast(context, 'Please correct the highlighted mistake fields.', error: true);
                return;
              }
              final Mistake next = Mistake(
                id: mistake?.id ?? newId(),
                userId: data.userId,
                chapterId: chosen.id,
                testId: testId,
                mistakeType: type,
                questionNote: question.text.trim(),
                solutionNote: solution.text.trim(),
                imagePath: mistake?.imagePath,
                retryLater: retryLater,
                retryStatus: mistake?.retryStatus ?? 'pending',
                createdAt: mistake?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref.read(dataControllerProvider.notifier).saveMistake(next, image: picked);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) {
                  showToast(context, creating ? 'Saved to your mistake notebook.' : 'Mistake note updated.');
                }
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: Text(creating ? 'Add to notebook' : 'Save note'),
          ),
          if (!creating)
            TextButton(
              onPressed: () async {
                final bool confirmed = await confirmAction(
                  context,
                  title: 'Delete this mistake?',
                  message: 'The entry and its private image are removed for good.',
                );
                if (!confirmed) return;
                try {
                  await ref.read(dataControllerProvider.notifier).deleteMistake(mistake);
                  if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                  if (context.mounted) showToast(context, 'Mistake deleted.');
                } catch (error) {
                  if (context.mounted) showToast(context, error.toString(), error: true);
                }
              },
              child: Text('Delete', style: TextStyle(color: context.stracker.palette.red)),
            ),
        ],
      ),
    ),
  );
  question.dispose();
  solution.dispose();
}
