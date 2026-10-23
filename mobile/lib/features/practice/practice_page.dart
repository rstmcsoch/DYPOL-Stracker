import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/validators.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/progress.dart';
import '../shell/app_shell.dart';

/// Practice / DPP log per chapter. Kept separate from tests, exactly like the website:
/// practice blocks never count as tests, and a chapter only gets a practice signal with
/// at least 20 attempted questions.
class PracticePage extends ConsumerStatefulWidget {
  const PracticePage({super.key});

  @override
  ConsumerState<PracticePage> createState() => _PracticePageState();
}

class _PracticePageState extends ConsumerState<PracticePage> {
  String _subject = 'All';

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final Map<String, PracticeAggregate> byChapter = practiceByChapter(data);
    final PracticeAggregate overall = aggregatePractice(data.practiceSessions);
    final List<PracticeSession> rows = data.practiceSessions.where((PracticeSession session) {
      if (_subject == 'All') return true;
      final Chapter? chapter = data.chapter(session.chapterId);
      return chapter?.subject == _subject;
    }).toList()
      ..sort((PracticeSession a, PracticeSession b) =>
          b.practiceDate.compareTo(a.practiceDate));

    return SectionPage(
      title: 'Practice / DPP',
      subtitle: '${overall.attempted} questions · ${percentLabel(overall.accuracy)} accuracy',
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => openPracticeEditor(context, ref, data, null),
        backgroundColor: colors.palette.accentDark,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add, size: 19),
        label: const Text('Log practice'),
      ),
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          NotebookCard(
            title: 'Practice summary',
            subtitle: 'Agregates over every block in view.',
            child: Column(
              children: <Widget>[
                WrapGrid(
                  children: <Widget>[
                    StatTile(value: '${overall.attempted}', label: 'Attempted'),
                    StatTile(
                      value: '${overall.correct}',
                      label: 'Correct',
                      tone: colors.palette.green,
                    ),
                    StatTile(value: '${overall.incorrect}', label: 'Incorrect', tone: colors.palette.red),
                    StatTile(
                      value: percentLabel(overall.accuracy),
                      label: 'Accuracy',
                      hint: 'correct ÷ attempted',
                    ),
                    StatTile(
                      value: percentLabel(overall.recentAccuracy),
                      label: 'Last 3 blocks',
                      hint: 'recent accuracy',
                    ),
                    StatTile(value: minutesLabel(overall.timeMinutes), label: 'Time logged'),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: <Widget>[
                for (final String subject in <String>['All', ...data.subjects])
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
                            ? colors.palette.textAccent
                            : colors.palette.inkSoft,
                      ),
                      backgroundColor: colors.palette.paperSoft,
                      selectedColor: colors.palette.accentLight,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          if (byChapter.isNotEmpty) ...<Widget>[
            NotebookCard(
              title: 'By chapter',
              child: Column(
                children: <Widget>[
                  for (final MapEntry<String, PracticeAggregate> entry in byChapter.entries)
                    if (data.chapter(entry.key) != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Row(
                              children: <Widget>[
                                Expanded(
                                  child: Text(
                                    data.chapterName(entry.key),
                                    style: Theme.of(context).textTheme.bodySmall,
                                  ),
                                ),
                                Text(
                                  '${entry.value.correct}/${entry.value.attempted} · '
                                  '${percentLabel(entry.value.accuracy)}',
                                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                        color: entry.value.attempted >= practiceMinAttemptsForSignal &&
                                                (entry.value.accuracy ?? 100) <
                                                    data.settings.weakThreshold
                                            ? colors.palette.red
                                            : colors.muted,
                                      ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 3),
                            LinearBar(
                              value: (entry.value.accuracy ?? 0) / 100,
                              height: 5,
                              color: (entry.value.accuracy ?? 0) < data.settings.weakThreshold
                                  ? colors.palette.red
                                  : colors.palette.accent,
                            ),
                          ],
                        ),
                      ),
                ],
              ),
            ),
            const SizedBox(height: 10),
          ],
          if (rows.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: 'No practice logged yet',
                message: 'Log a DPP, module or practice sheet per chapter. Minutes you record here '
                    'also count towards study time.',
                icon: Icons.checklist_rtl_outlined,
                action: ElevatedButton(
                  onPressed: () => openPracticeEditor(context, ref, data, null),
                  child: const Text('Log practice'),
                ),
              ),
            )
          else
            for (final PracticeSession session in rows)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: NotebookCard(
                  dense: true,
                  onTap: () => openPracticeEditor(context, ref, data, session),
                  child: Row(
                    children: <Widget>[
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Row(
                              children: <Widget>[
                                Expanded(
                                  child: Text(
                                    data.chapterName(session.chapterId),
                                    style: Theme.of(context).textTheme.titleSmall,
                                  ),
                                ),
                                Pill(
                                  percentLabel(session.accuracy),
                                  tone: (session.accuracy ?? 0) >= data.settings.strongThreshold
                                      ? PillTone.good
                                      : (session.accuracy ?? 0) < data.settings.weakThreshold
                                          ? PillTone.bad
                                          : PillTone.neutral,
                                  dense: true,
                                ),
                              ],
                            ),
                            const SizedBox(height: 3),
                            Text(
                              '${formatDate(session.practiceDate)} · ${session.source} · '
                              '${session.attempted} attempted · ${session.correct} correct · '
                              '${session.incorrect} wrong'
                              '${session.timeMinutes != null ? ' · ${minutesLabel(session.timeMinutes)}' : ''}',
                              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: colors.muted,
                                  ),
                            ),
                            if (session.notes.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 3),
                                child: Text(
                                  session.notes,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ),
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right, size: 18),
                    ],
                  ),
                ),
              ),
        ],
      ),
    );
  }
}

Future<void> openPracticeEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  PracticeSession? session,
) async {
  if (data.chapters.isEmpty) {
    showToast(context, 'Add a chapter in the syllabus first.', error: true);
    return;
  }
  final bool creating = session == null;
  Chapter selected = data.chapter(session?.chapterId) ?? data.chapters.first;
  final TextEditingController attempted = TextEditingController(text: session?.attempted.toString() ?? '');
  final TextEditingController correct = TextEditingController(text: session?.correct.toString() ?? '');
  final TextEditingController incorrect = TextEditingController(text: session?.incorrect.toString() ?? '');
  final TextEditingController minutes = TextEditingController(
    text: session?.timeMinutes?.toString() ?? '',
  );
  final TextEditingController notes = TextEditingController(text: session?.notes ?? '');
  String source = session?.source ?? 'DPP';
  String date = session?.practiceDate ?? todayIso();
  String? attemptedError;
  String? countsError;

  await showAppSheet<void>(
    context,
    title: creating ? 'Log practice' : 'Edit practice',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          InkWell(
            onTap: () async {
              final Chapter? picked = await _pickChapter(context, data, selected);
              if (picked != null) setSheetState(() => selected = picked);
            },
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: context.stracker.palette.paperSoft,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: context.stracker.palette.line),
              ),
              child: Row(
                children: <Widget>[
                  Icon(Icons.menu_book_outlined, size: 18, color: context.stracker.muted),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text('Chapter', style: Theme.of(context).textTheme.labelSmall),
                        Text(selected.name, style: Theme.of(context).textTheme.titleSmall),
                        Text(
                          selected.subject,
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                color: context.stracker.muted,
                              ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.expand_more, size: 18),
                ],
              ),
            ),
          ),
          AppDateField(label: 'Practice date', value: date, onChanged: (String? value) {
            if (value != null) setSheetState(() => date = value);
          }),
          Row(
            children: <Widget>[
              Expanded(
                child: AppField(
                  label: 'Attempted',
                  controller: attempted,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                  error: attemptedError,
                  required: true,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppField(
                  label: 'Correct',
                  controller: correct,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                  error: countsError,
                  required: true,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppField(
                  label: 'Incorrect',
                  controller: incorrect,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                ),
              ),
            ],
          ),
          AppSelect<String>(
            label: 'Source',
            value: source,
            items: const <String>['DPP', 'Module', 'Practice sheet', 'Coaching material', 'Other'],
            onChanged: (String? value) => setSheetState(() => source = value ?? source),
          ),
          AppField(
            label: 'Minutes (optional)',
            controller: minutes,
            keyboardType: TextInputType.number,
            inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
            helper: 'Minutes are mirrored into study time under Practice.',
            error: Validators.minutes(minutes.text, label: 'Minutes'),
          ),
          AppField(label: 'Notes', controller: notes, maxLines: 3, maxLength: 5000),
          ElevatedButton(
            onPressed: () async {
              final int attemptedValue = int.tryParse(attempted.text.trim()) ?? -1;
              final int correctValue = int.tryParse(correct.text.trim()) ?? -1;
              final int incorrectValue = incorrect.text.trim().isEmpty
                  ? 0
                  : (int.tryParse(incorrect.text.trim()) ?? -1);
              final String? countError =
                  Validators.practiceCounts(
                attempted: attemptedValue,
                correct: correctValue.clamp(0, 1 << 31),
                incorrect: incorrectValue.clamp(0, 1 << 31),
              );
              setSheetState(() {
                attemptedError = attemptedValue < 0 ? 'Enter the attempted count.' : null;
                countsError = correctValue < 0 ? 'Enter the correct count.' : countError;
              });
              if (attemptedError != null || countError != null) return;
              final int minutesValue = int.tryParse(minutes.text.trim()) ?? 0;
              final PracticeSession next = PracticeSession(
                id: session?.id ?? newId(),
                userId: data.userId,
                chapterId: selected.id,
                practiceDate: date,
                attempted: attemptedValue,
                correct: correctValue,
                incorrect: incorrectValue,
                source: source,
                timeMinutes: minutesValue > 0 ? minutesValue : null,
                notes: notes.text,
                createdAt: session?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref.read(dataControllerProvider.notifier).savePractice(next);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, creating ? 'Practice logged.' : 'Practice updated.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: Text(creating ? 'Log practice' : 'Save changes'),
          ),
          if (!creating)
            TextButton(
              onPressed: () async {
                final bool confirmed = await confirmAction(
                  context,
                  title: 'Delete this practice block?',
                  message: 'The record is removed from your account on the website too.',
                );
                if (!confirmed) return;
                try {
                  await ref.read(dataControllerProvider.notifier).deletePractice(session!);
                  if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                  if (context.mounted) showToast(context, 'Practice block deleted.');
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
  attempted.dispose();
  correct.dispose();
  incorrect.dispose();
  minutes.dispose();
  notes.dispose();
}

Future<Chapter?> _pickChapter(BuildContext context, AppData data, Chapter current) {
  final TextEditingController query = TextEditingController();
  return showModalBottomSheet<Chapter>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: context.stracker.palette.paper,
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) {
        final String needle = query.text.trim().toLowerCase();
        final List<Chapter> rows = data.chapters
            .where((Chapter chapter) =>
                needle.isEmpty ||
                '${chapter.name} ${chapter.subject}'.toLowerCase().contains(needle))
            .take(120)
            .toList();
        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheetContext).bottom),
          child: SizedBox(
            height: MediaQuery.sizeOf(sheetContext).height * 0.8,
            child: Column(
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                  child: SearchBox(
                    controller: query,
                    hint: 'Search all chapters',
                    onChanged: (_) => setSheetState(() {}),
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: rows.length,
                    itemBuilder: (BuildContext context, int index) {
                      final Chapter chapter = rows[index];
                      return ListTile(
                        dense: true,
                        selected: chapter.id == current.id,
                        title: Text(chapter.name),
                        subtitle: Text(chapter.subject),
                        onTap: () => Navigator.of(sheetContext).pop(chapter),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    ),
  );
}
