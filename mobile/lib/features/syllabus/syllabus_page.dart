import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/analytics.dart';
import '../../logic/progress.dart';
import '../revision/revision_actions.dart';
import '../shell/app_shell.dart';
import '../../core/iterables.dart';

/// Syllabus notebook: every chapter with its status, importance, five preparation
/// stages, practice accuracy and pipeline progress. Search, filter, sort and reorder
/// work the same way as the website.
class SyllabusPage extends ConsumerStatefulWidget {
  const SyllabusPage({super.key});

  @override
  ConsumerState<SyllabusPage> createState() => _SyllabusPageState();
}

class _SyllabusPageState extends ConsumerState<SyllabusPage> {
  final TextEditingController _search = TextEditingController();
  String _subject = 'All';
  String _status = 'All';
  String _sort = 'Syllabus order';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final SyllabusProgress progress = syllabusProgress(data);
    final Map<String, PracticeAggregate> practice = practiceByChapter(data);
    final List<String> subjects = <String>['All', ...data.subjects];
    final String needle = _search.text.trim().toLowerCase();

    List<Chapter> rows = data.chapters.where((Chapter chapter) {
      final bool matchesSubject = _subject == 'All' || chapter.subject == _subject;
      final bool matchesStatus = _status == 'All' || chapter.status == _status;
      final bool matchesQuery = needle.isEmpty ||
          '${chapter.name} ${chapter.subject} ${chapter.notes} ${chapter.formulaNotes}'
              .toLowerCase()
              .contains(needle);
      return matchesSubject && matchesStatus && matchesQuery;
    }).toList();

    int subjectRank(Chapter chapter) => data.subjects.indexOf(chapter.subject);
    switch (_sort) {
      case 'Priority':
        const List<String> order = <String>['High', 'Medium', 'Low'];
        rows.sort((Chapter a, Chapter b) => order.indexOf(a.priority).compareTo(order.indexOf(b.priority)));
      case 'Name':
        rows.sort((Chapter a, Chapter b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      case 'Weakest first':
        rows.sort((Chapter a, Chapter b) {
          final double? first = practice[a.id]?.accuracy;
          final double? second = practice[b.id]?.accuracy;
          if (first == null && second == null) return 0;
          if (first == null) return 1;
          if (second == null) return -1;
          return first.compareTo(second);
        });
      default:
        rows.sort((Chapter a, Chapter b) {
          final int bySubject = subjectRank(a).compareTo(subjectRank(b));
          return bySubject != 0 ? bySubject : a.position.compareTo(b.position);
        });
    }

    return SectionPage(
      title: 'Syllabus',
      subtitle: '${progress.completedChapters}/${progress.totalChapters} chapters · '
          '${percentLabel(progress.raw)} raw · ${percentLabel(progress.weighted)} weighted',
      actions: <Widget>[
        IconButton(
          tooltip: 'Add chapter',
          icon: const Icon(Icons.add, size: 22),
          onPressed: () => openChapterEditor(context, ref, data, null),
        ),
      ],
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          SearchBox(controller: _search, hint: 'Search chapters and notes', onChanged: (_) => setState(() {})),
          const SizedBox(height: 10),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: <Widget>[
                for (final String subject in subjects)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(subject),
                      selected: _subject == subject,
                      onSelected: (_) => setState(() => _subject = subject),
                      showCheckmark: false,
                      labelStyle: TextStyle(
                        fontFamily: 'PatrickHand',
                        fontSize: 14,
                        color: _subject == subject
                            ? context.stracker.palette.textAccent
                            : context.stracker.palette.inkSoft,
                      ),
                      backgroundColor: context.stracker.palette.paperSoft,
                      selectedColor: context.stracker.palette.accentLight,
                      side: BorderSide(
                        color: _subject == subject
                            ? context.stracker.palette.accent
                            : context.stracker.palette.line,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: <Widget>[
              Expanded(
                child: AppSelect<String>(
                  label: 'Status',
                  value: _status,
                  items: const <String>['All', 'Not Started', 'Studying', 'Done', 'Revised'],
                  onChanged: (String? value) => setState(() => _status = value ?? 'All'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppSelect<String>(
                  label: 'Sort',
                  value: _sort,
                  items: const <String>['Syllabus order', 'Priority', 'Name', 'Weakest first'],
                  onChanged: (String? value) => setState(() => _sort = value ?? 'Syllabus order'),
                ),
              ),
            ],
          ),
          if (rows.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: 'No chapters match',
                message: needle.isEmpty
                    ? 'Add a chapter to start this subject.'
                    : 'Try a different search or clear the filters.',
                icon: Icons.menu_book_outlined,
                action: OutlinedButton(
                  onPressed: () {
                    setState(() {
                      _search.clear();
                      _subject = 'All';
                      _status = 'All';
                    });
                  },
                  child: const Text('Clear filters'),
                ),
              ),
            )
          else
            for (final Chapter chapter in rows)
              _ChapterCard(
                chapter: chapter,
                data: data,
                practice: practice[chapter.id],
              ),
          const SizedBox(height: 8),
          InfoBanner(
            'Stages accept evidence: PYQs come from your PYQ records, Revised from a completed '
            'revision, Tested from a logged test. Manual toggles are your own claim and are shown as '
            'such.',
          ),
        ],
      ),
    );
  }
}

class _ChapterCard extends ConsumerWidget {
  const _ChapterCard({required this.chapter, required this.data, this.practice});

  final Chapter chapter;
  final AppData data;
  final PracticeAggregate? practice;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final List<StageState> stages = chapterStages(data, chapter);
    final double pipeline = chapterPipelinePercent(stages);
    final ChapterPerformance? performance = chapterPerformance(data)
        .where((ChapterPerformance row) => row.chapter.id == chapter.id)
        .firstOrNull;
    final Color subjectColor = colors.subjectColor(chapter.subject);
    final List<Revision> open = data.revisions
        .where((Revision revision) =>
            revision.chapterId == chapter.id && revision.completedAt == null)
        .toList();

    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: NotebookCard(
        accent: subjectColor,
        onTap: () => openChapterEditor(context, ref, data, chapter),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(chapter.name, style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 3),
                      Wrap(
                        spacing: 5,
                        runSpacing: 4,
                        children: <Widget>[
                          Pill(chapter.subject, tone: PillTone.neutral, dense: true),
                          Pill(
                            chapter.status,
                            tone: chapter.isComplete
                                ? PillTone.good
                                : (chapter.status == 'Studying' ? PillTone.accent : PillTone.neutral),
                            dense: true,
                          ),
                          Pill('${chapter.priority} priority', dense: true),
                          if (chapter.importance != 'medium')
                            Pill('${chapter.importance} weight', tone: PillTone.warn, dense: true),
                          if (open.isNotEmpty)
                            Pill('R${open.first.revisionNumber} due ${dueLabel(open.first.dueOn)}',
                                tone: isPast(open.first.dueOn) ? PillTone.bad : PillTone.warn, dense: true),
                        ],
                      ),
                    ],
                  ),
                ),
                ProgressRing(value: pipeline, size: 46, stroke: 5, center: const SizedBox.shrink()),
              ],
            ),
            const SizedBox(height: 9),
            Row(
              children: <Widget>[
                for (final StageState stage in stages)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: Tooltip(
                      message: '${stage.label} · ${stage.source}',
                      child: InkWell(
                        borderRadius: BorderRadius.circular(8),
                        onTap: () => toggleChapterStage(context, ref, data, chapter, stage),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                          decoration: BoxDecoration(
                            color: stage.done ? colors.palette.greenBg : colors.palette.paperMuted,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: stage.done
                                  ? colors.palette.green.withValues(alpha: 0.4)
                                  : colors.palette.line,
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              Icon(
                                stage.done
                                    ? Icons.check_circle
                                    : (stage.progress > 0 ? Icons.timelapse : Icons.circle_outlined),
                                size: 11,
                                color: stage.done ? colors.palette.green : colors.muted,
                              ),
                              const SizedBox(width: 3),
                              Text(
                                stage.label,
                                style: TextStyle(
                                  fontFamily: 'Lexend',
                                  fontSize: 10,
                                  fontWeight: FontWeight.w500,
                                  color: stage.done ? colors.palette.green : colors.palette.inkSoft,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                if (practice != null && practice!.attempted > 0)
                  Expanded(
                    child: Text(
                      'Practice: ${percentLabel(practice!.accuracy)} over ${practice!.attempted} questions'
                      '${practice!.attempted < practiceMinAttemptsForSignal ? ' (needs 20+ for a signal)' : ''}',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                    ),
                  )
                else
                  Expanded(
                    child: Text(
                      performance?.average == null
                          ? 'No practice or test evidence yet.'
                          : 'Test average ${percentLabel(performance!.average)} · ${performance!.classification}',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                    ),
                  ),
                if (chapter.notes.isNotEmpty)
                  Icon(Icons.sticky_note_2_outlined, size: 14, color: colors.palette.accent),
                if (chapter.formulaNotes.isNotEmpty) ...<Widget>[
                  const SizedBox(width: 5),
                  Icon(Icons.functions, size: 14, color: colors.palette.accent),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Chapter editor: status, priority, importance, notes, formula notes, stages, revision
/// scheduling, reordering and deletion.
Future<void> openChapterEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  Chapter? chapter,
) async {
  final bool creating = chapter == null;
  final TextEditingController name = TextEditingController(text: chapter?.name ?? '');
  final TextEditingController notes = TextEditingController(text: chapter?.notes ?? '');
  final TextEditingController formulas = TextEditingController(text: chapter?.formulaNotes ?? '');
  String subject = chapter?.subject ?? (data.subjects.isEmpty ? 'Physics' : data.subjects.first);
  String status = chapter?.status ?? 'Not Started';
  String priority = chapter?.priority ?? 'Medium';
  String importance = chapter?.importance ?? 'medium';
  String? nameError;

  await showAppSheet<void>(
    context,
    title: creating ? 'Add chapter' : chapter.name,
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) {
        final Chapter? live = creating
            ? null
            : data.chapters.where((Chapter row) => row.id == chapter.id).firstOrNull;
        final Chapter base = live ?? chapter ?? Chapter(
          id: newId(),
          userId: data.userId,
          subject: subject,
          name: name.text,
          createdAt: isoNow(),
          updatedAt: isoNow(),
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            if (!creating) ...<Widget>[
              Wrap(
                spacing: 5,
                runSpacing: 5,
                children: <Widget>[
                  for (final StageState stage in chapterStages(data, base))
                    Pill(
                      '${stage.label} · ${stage.source}',
                      tone: stage.done ? PillTone.good : PillTone.neutral,
                      dense: true,
                    ),
                ],
              ),
              const SizedBox(height: 12),
            ],
            AppField(
              label: 'Chapter name',
              controller: name,
              error: nameError,
              required: true,
              textCapitalization: TextCapitalization.words,
            ),
            AppSelect<String>(
              label: 'Subject',
              value: subject,
              items: data.subjects,
              onChanged: (String? value) => setSheetState(() => subject = value ?? subject),
            ),
            AppSelect<String>(
              label: 'Status',
              value: status,
              items: const <String>['Not Started', 'Studying', 'Done', 'Revised'],
              onChanged: (String? value) => setSheetState(() => status = value ?? status),
            ),
            Row(
              children: <Widget>[
                Expanded(
                  child: AppSelect<String>(
                    label: 'Priority',
                    value: priority,
                    items: const <String>['High', 'Medium', 'Low'],
                    onChanged: (String? value) => setSheetState(() => priority = value ?? priority),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: AppSelect<String>(
                    label: 'Importance (weight)',
                    value: importance,
                    items: const <String>['high', 'medium', 'low'],
                    onChanged: (String? value) => setSheetState(() => importance = value ?? importance),
                  ),
                ),
              ],
            ),
            AppField(label: 'Notes', controller: notes, maxLines: 4, maxLength: 20000),
            AppField(label: 'Formula notes', controller: formulas, maxLines: 3, maxLength: 20000),
            if (!creating) ...<Widget>[
              const SectionHeading('Preparation stages', padding: EdgeInsets.only(bottom: 6)),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: <Widget>[
                  for (final StageState stage in chapterStages(data, base))
                    FilterChip(
                      label: Text(stage.label),
                      selected: stage.done,
                      showCheckmark: true,
                      onSelected: (_) => toggleChapterStage(context, ref, data, base, stage),
                    ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        await scheduleRevision(context, ref, data, base);
                        setSheetState(() {});
                      },
                      icon: const Icon(Icons.alarm_add, size: 17),
                      label: const Text('Schedule revision'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        await moveChapter(context, ref, data, base, -1);
                        setSheetState(() {});
                      },
                      icon: const Icon(Icons.arrow_upward, size: 16),
                      label: const Text('Up'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        await moveChapter(context, ref, data, base, 1);
                        setSheetState(() {});
                      },
                      icon: const Icon(Icons.arrow_downward, size: 16),
                      label: const Text('Down'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              TextButton.icon(
                onPressed: () async {
                  final bool confirmed = await confirmAction(
                    context,
                    title: 'Delete ${base.name}?',
                    message: 'Revisions, practice blocks, PYQs, cards and mistakes for this chapter are '
                        'removed too. This cannot be undone from the app.',
                    confirmLabel: 'Delete chapter',
                  );
                  if (!confirmed) return;
                  try {
                    await ref.read(dataControllerProvider.notifier).deleteChapter(base);
                    if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                    if (context.mounted) showToast(context, 'Chapter deleted.');
                  } catch (error) {
                    if (context.mounted) showToast(context, error.toString(), error: true);
                  }
                },
                icon: Icon(Icons.delete_outline, size: 17, color: context.stracker.palette.red),
                label: Text('Delete chapter', style: TextStyle(color: context.stracker.palette.red)),
              ),
            ],
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: () async {
                final String trimmed = name.text.trim();
                if (trimmed.isEmpty) {
                  setSheetState(() => nameError = 'Chapter name is required.');
                  return;
                }
                final Chapter next = base.copyWith(
                  subject: subject,
                  name: trimmed,
                  status: status,
                  priority: priority,
                  importance: importance,
                  notes: notes.text,
                  formulaNotes: formulas.text,
                  completedOn: (status == 'Done' || status == 'Revised')
                      ? (base.completedOn ?? todayIso())
                      : null,
                  position: base.position,
                );
                try {
                  await ref.read(dataControllerProvider.notifier).saveChapter(next);
                  if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                  if (context.mounted) {
                    showToast(context, creating ? 'Chapter added.' : 'Chapter saved.');
                  }
                } catch (error) {
                  if (context.mounted) showToast(context, error.toString(), error: true);
                }
              },
              child: Text(creating ? 'Add chapter' : 'Save chapter'),
            ),
          ],
        );
      },
    ),
  );
  name.dispose();
  notes.dispose();
  formulas.dispose();
}

/// Toggles one stage. PYQs, Revised and Tested can only be *claimed* here — the real
/// evidence stays visible next to them.
Future<void> toggleChapterStage(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  Chapter chapter,
  StageState stage,
) async {
  if (stage.source == 'evidence') {
    showToast(context, '${stage.label} is already proven by your own records.');
    return;
  }
  final ChapterStageRow? existing = data.chapterStages
      .where((ChapterStageRow row) => row.chapterId == chapter.id && row.stage == stage.key)
      .firstOrNull;
  final bool nextDone = !(existing?.done ?? false);
  final ChapterStageRow row = ChapterStageRow(
    id: existing?.id ?? newId(),
    userId: data.userId,
    chapterId: chapter.id,
    stage: stage.key,
    done: nextDone,
    completedAt: nextDone ? isoNow() : null,
    createdAt: existing?.createdAt ?? isoNow(),
    updatedAt: isoNow(),
  );
  try {
    await ref.read(dataControllerProvider.notifier).saveStage(row);
    if (context.mounted) {
      showToast(context, '${stage.label} ${nextDone ? 'marked' : 'cleared'}.');
    }
  } catch (error) {
    if (context.mounted) showToast(context, error.toString(), error: true);
  }
}

Future<void> moveChapter(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  Chapter chapter,
  int delta,
) async {
  final List<Chapter> siblings = data.chaptersFor(chapter.subject);
  final int index = siblings.indexWhere((Chapter row) => row.id == chapter.id);
  final int target = index + delta;
  if (index < 0 || target < 0 || target >= siblings.length) return;
  final Chapter other = siblings[target];
  try {
    await ref.read(dataControllerProvider.notifier).saveChapters(<Chapter>[
      chapter.copyWith(position: other.position),
      other.copyWith(position: chapter.position),
    ]);
  } catch (error) {
    if (context.mounted) showToast(context, error.toString(), error: true);
  }
}
