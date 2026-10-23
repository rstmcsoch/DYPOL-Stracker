import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/date.dart';
import '../../core/iterables.dart';
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

const List<String> mistakeTypes = <String>[
  'Concept',
  'Calculation',
  'Silly',
  'Time pressure',
  'Unattempted',
  'Guess',
];

class MistakesPage extends ConsumerStatefulWidget {
  const MistakesPage({super.key});

  @override
  ConsumerState<MistakesPage> createState() => _MistakesPageState();
}

class _MistakesPageState extends ConsumerState<MistakesPage> {
  final TextEditingController _search = TextEditingController();
  String _type = 'All';
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
      final bool matchesType = _type == 'All' || mistake.mistakeType == _type;
      final bool matchesStatus = _status == 'All' || mistake.retryStatus == _status;
      final bool matchesQuery = needle.isEmpty ||
          '${mistake.questionNote} ${mistake.solutionNote} ${data.chapterName(mistake.chapterId)}'
              .toLowerCase()
              .contains(needle);
      return matchesType && matchesStatus && matchesQuery;
    }).toList()
      ..sort((Mistake a, Mistake b) => b.createdAt.compareTo(a.createdAt));

    return SectionPage(
      title: 'Mistake notebook',
      subtitle: '${summary.total} logged · ${summary.pendingRetries} waiting for a retry',
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
        label: const Text('Add mistake'),
      ),
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          SearchBox(controller: _search, hint: 'Search questions and solutions', onChanged: (_) => setState(() {})),
          const SizedBox(height: 8),
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
                  label: 'Retry status',
                  value: _status,
                  items: const <String>['All', 'pending', 'retrying', 'resolved'],
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
                title: data.mistakes.isEmpty ? 'Nothing in the notebook' : 'No mistakes match',
                message: 'A mistake notebook is only as good as its entries. Log what went wrong, '
                    'why, and how you will recognise it next time.',
                icon: Icons.book_outlined,
                action: ElevatedButton(
                  onPressed: () => openMistakeEditor(context, ref, data, null),
                  child: const Text('Add the first one'),
                ),
              ),
            )
          else
            for (final Mistake mistake in rows) _MistakeCard(mistake: mistake, data: data),
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
                  tone: mistake.retryStatus == 'resolved'
                      ? PillTone.good
                      : (mistake.retryStatus == 'retrying' ? PillTone.warn : PillTone.bad),
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
                  formatDate(mistake.createdAt),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(mistake.questionNote, style: Theme.of(context).textTheme.bodyMedium),
            if (mistake.solutionNote.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Text(
                  mistake.solutionNote,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.inkSoft),
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
                if (mistake.retryLater)
                  Pill('Retry later', tone: PillTone.warn, dense: true),
                const Spacer(),
                if (mistake.retryStatus != 'resolved')
                  TextButton(
                    onPressed: () async {
                      try {
                        await ref.read(dataControllerProvider.notifier).saveMistake(
                              mistake.copyWith(retryStatus: 'resolved'),
                            );
                        if (context.mounted) showToast(context, 'Marked resolved.');
                      } catch (error) {
                        if (context.mounted) showToast(context, error.toString(), error: true);
                      }
                    },
                    child: const Text('Resolved'),
                  )
                else
                  Text(
                    'Resolved',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.palette.green),
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
    final Uint8List? bytes =
        await ref.read(dataControllerProvider.notifier).mistakeImageBytes(widget.path);
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
        child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
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
  String type = mistake?.mistakeType ?? mistakeTypes.first;
  String chapterId = mistake?.chapterId ?? data.chapters.first.id;
  String? testId = mistake?.testId;
  bool retryLater = mistake?.retryLater ?? true;
  String retryStatus = mistake?.retryStatus ?? 'pending';
  File? picked;
  String? error;

  await showAppSheet<void>(
    context,
    title: creating ? 'Add a mistake' : 'Edit mistake',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppSelect<String>(
            label: 'Type',
            value: type,
            items: mistakeTypes,
            onChanged: (String? value) => setSheetState(() => type = value ?? type),
          ),
          AppSelect<String>(
            label: 'Chapter',
            value: chapterId,
            items: <String>[for (final Chapter chapter in data.chapters) chapter.id],
            labelFor: (String id) => data.chapterName(id),
            onChanged: (String? value) => setSheetState(() => chapterId = value ?? chapterId),
          ),
          AppSelect<String?>(
            label: 'From a test (optional)',
            value: testId,
            items: <String?>[null, ...data.tests.map((TestRecord test) => test.id)],
            labelFor: (String? id) => id == null
                ? 'Not linked'
                : data.tests.firstWhere((TestRecord test) => test.id == id).title,
            onChanged: (String? value) => setSheetState(() => testId = value),
          ),
          AppField(
            label: 'What was the question?',
            controller: question,
            maxLines: 4,
            maxLength: 4000,
            required: true,
            error: error,
          ),
          AppField(
            label: 'What went wrong, and the fix',
            controller: solution,
            maxLines: 4,
            maxLength: 4000,
          ),
          SwitchRow(
            title: 'Add to the retry queue',
            subtitle: 'Retries remember the mistake instead of re-reading it.',
            value: retryLater,
            onChanged: (bool value) => setSheetState(() => retryLater = value),
          ),
          ChoiceRow<String>(
            label: 'Retry status',
            value: retryStatus,
            options: const <String>['pending', 'retrying', 'resolved'],
            onChanged: (String value) => setSheetState(() => retryStatus = value),
          ),
          OutlinedButton.icon(
            onPressed: () async {
              final XFile? file =
                  await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
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
            'Images go to your private mistake-images folder in the same Supabase project. '
            'The app uploads the file as-is; the website converts to WebP.',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: context.stracker.muted),
          ),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: () async {
              if (question.text.trim().isEmpty) {
                setSheetState(() => error = 'Describe the question.');
                return;
              }
              final Mistake next = Mistake(
                id: mistake?.id ?? newId(),
                userId: data.userId,
                chapterId: chapterId,
                testId: testId,
                mistakeType: type,
                questionNote: question.text,
                solutionNote: solution.text,
                imagePath: mistake?.imagePath,
                retryLater: retryLater,
                retryStatus: retryStatus,
                createdAt: mistake?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref
                    .read(dataControllerProvider.notifier)
                    .saveMistake(next, image: picked);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, creating ? 'Mistake logged.' : 'Mistake saved.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: Text(creating ? 'Save mistake' : 'Save changes'),
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
                  await ref.read(dataControllerProvider.notifier).deleteMistake(mistake!);
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
