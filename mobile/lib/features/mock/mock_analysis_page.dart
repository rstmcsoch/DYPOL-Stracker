import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/home_summary.dart';
import '../../logic/mock.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';
import '../tests/tests_page.dart';

/// Mock analysis (website MockAnalysisPage): any recorded test, with recorded time and
/// attempts, the student's own lost-mark classifications, and derived lines that each say
/// what they are based on. Nothing is estimated.
class MockAnalysisPage extends ConsumerStatefulWidget {
  const MockAnalysisPage({super.key});

  @override
  ConsumerState<MockAnalysisPage> createState() => _MockAnalysisPageState();
}

class _MockAnalysisPageState extends ConsumerState<MockAnalysisPage> {
  String? _testId;

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final List<TestRecord> tests = <TestRecord>[...data.tests]
      ..sort((TestRecord a, TestRecord b) => b.testDate.compareTo(a.testDate));
    TestRecord? selected;
    for (final TestRecord test in tests) {
      if (test.id == _testId) selected = test;
    }
    selected ??= tests.isEmpty ? null : tests.first;

    return SectionPage(
      title: 'Mock analysis',
      subtitle: selected == null ? 'Record a test first.' : 'Recorded, classified and derived data, kept separate.',
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          if (selected == null)
            NotebookCard(
              child: EmptyState(
                title: 'No tests to analyse yet.',
                message: '',
                icon: Icons.analytics_outlined,
                action: ElevatedButton(
                  onPressed: () => openTestEditor(context, ref, data, null),
                  child: const Text('Log a test'),
                ),
              ),
            )
          else
            _MockDetail(
              data: data,
              tests: tests,
              test: selected,
              onSelect: (String id) => setState(() => _testId = id),
            ),
        ],
      ),
    );
  }
}

String _webMinutes(int? minutes) {
  if (minutes == null) return '—';
  final int safe = minutes < 0 ? 0 : minutes;
  final int hours = safe ~/ 60;
  final int mins = safe % 60;
  return hours > 0 ? '${hours}h ${mins.toString().padLeft(2, '0')}m' : '${mins}m';
}

class _MockDetail extends ConsumerWidget {
  const _MockDetail({required this.data, required this.tests, required this.test, required this.onSelect});

  final AppData data;
  final List<TestRecord> tests;
  final TestRecord test;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final ({double? score, int taggedQuestions, double? taggedMarks}) summary = mockSummary(test, data);
    final List<SubjectTimeRow> times = subjectTimeRows(test, data);
    final bool hasRecordedTime = data.timeEntries.any(
      (TestTimeEntry e) => e.testId == test.id && (e.minutes != null || e.attempted != null || e.unattempted != null),
    );
    final List<TestErrorLog> logs = data.errorLogs.where((TestErrorLog row) => row.testId == test.id).toList();
    final List<CategoryTotal> totals = categoryTotals(logs);
    final List<MockInsight> insights = mockInsights(test, data);
    final TextStyle? muted = text.bodySmall?.copyWith(color: colors.muted);

    Widget stat(String label, String value) => SizedBox(
          width: 140,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(label, style: text.labelSmall?.copyWith(color: colors.muted)),
              Text(value, style: text.titleMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
          ),
        );

    final double maxBar = totals.isEmpty
        ? 0
        : totals
            .map((CategoryTotal t) => t.marksLost ?? t.entries.toDouble())
            .reduce((double a, double b) => a > b ? a : b);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        NotebookCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              AppSelect<String>(
                label: 'Test',
                value: test.id,
                items: <String>[for (final TestRecord row in tests) row.id],
                labelFor: (String id) {
                  final TestRecord row = tests.firstWhere((TestRecord candidate) => candidate.id == id);
                  return '${prettyDate(row.testDate)} · ${row.title} · ${row.testType}';
                },
                onChanged: (String? value) {
                  if (value != null) onSelect(value);
                },
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 12,
                runSpacing: 10,
                children: <Widget>[
                  stat('Recorded score', summary.score == null ? '—' : '${summary.score!.toStringAsFixed(1)}%'),
                  stat('Type', test.testType),
                  stat('Lost marks tagged', summary.taggedMarks == null ? '—' : jsNumberText(summary.taggedMarks!)),
                  stat('Questions tagged', summary.taggedQuestions == 0 ? '—' : '${summary.taggedQuestions}'),
                ],
              ),
            ],
          ),
        ),
        _Heading(
          title: 'Recorded time & attempts',
          note: 'Only what you entered. Missing values stay blank.',
          action: OutlinedButton.icon(
            onPressed: () => openTimeDataEditor(context, ref, data, test),
            icon: const Icon(Icons.schedule, size: 16),
            label: Text('${hasRecordedTime ? 'Edit' : 'Add'} time'),
          ),
        ),
        NotebookCard(
          child: times.isEmpty
              ? Text(
                  'No time or attempt data recorded for this test. Nothing is estimated — add it if you tracked it.',
                  style: muted,
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (final SubjectTimeRow row in times)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Pill(row.subject, dense: true, icon: Icons.circle),
                            const SizedBox(height: 4),
                            Wrap(
                              spacing: 14,
                              runSpacing: 4,
                              children: <Widget>[
                                _Num('Time', _webMinutes(row.minutes)),
                                _Num('Attempted', row.attempted?.toString() ?? '—'),
                                _Num('Unattempted', row.unattempted?.toString() ?? '—'),
                                _Num(
                                  'Marks',
                                  '${row.marks == null ? '—' : jsNumberText(row.marks!)}'
                                      '${row.total != null && row.total != 0 ? '/${jsNumberText(row.total!)}' : ''}',
                                ),
                              ],
                            ),
                            if (row.marksPerMinute != null)
                              Text('${row.marksPerMinute!.toStringAsFixed(2)} marks per minute spent', style: muted),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        _Heading(
          title: 'Lost marks, classified',
          note: 'Tag why marks were lost.',
          action: ElevatedButton.icon(
            onPressed: () => openErrorLogEditor(context, ref, data, test, null),
            icon: const Icon(Icons.add, size: 16),
            label: const Text('Classify'),
          ),
        ),
        NotebookCard(
          child: logs.isEmpty
              ? Text('No classifications yet.', style: muted)
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (final TestErrorLog log in logs) _LogRow(data: data, test: test, log: log),
                  ],
                ),
        ),
        const _Heading(title: 'Where the marks went', note: 'Your classifications, summed.'),
        NotebookCard(
          child: totals.isEmpty
              ? Text('Classify some lost marks to see the breakdown.', style: muted)
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (final CategoryTotal total in totals)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: LinearBar(
                          value: maxBar == 0
                              ? 0
                              : ((total.marksLost ?? total.entries.toDouble()) / maxBar).clamp(0, 1).toDouble(),
                          color: colors.palette.orange,
                          label: '${total.category} · '
                              '${total.marksLost != null ? '${jsNumberText(total.marksLost!)} marks' : '${total.entries} tag${total.entries == 1 ? '' : 's'}'}',
                        ),
                      ),
                  ],
                ),
        ),
        const _Heading(title: 'Fix before your next mock', note: 'Each line shows its basis.'),
        NotebookCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (insights.isEmpty)
                Text('Not enough data yet.', style: muted)
              else
                for (final MockInsight insight in insights)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Pill(
                          switch (insight.kind) {
                            'recorded' => 'Recorded',
                            'classified' => 'You classified',
                            _ => 'Derived',
                          },
                          dense: true,
                          tone: switch (insight.kind) {
                            'recorded' => PillTone.neutral,
                            'classified' => PillTone.accent,
                            _ => PillTone.warn,
                          },
                        ),
                        const SizedBox(width: 8),
                        Expanded(child: Text(insight.text, style: text.bodySmall)),
                      ],
                    ),
                  ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => Routes.open(context, Routes.weakAreas),
                  child: const Text('See weak areas →'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading({required this.title, this.note, this.action});

  final String title;
  final String? note;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 16, 2, 8),
      child: Wrap(
        spacing: 8,
        runSpacing: 6,
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Semantics(header: true, child: Text(title, style: text.titleMedium)),
              if (note != null) Text(note!, style: text.labelSmall?.copyWith(color: context.stracker.muted)),
            ],
          ),
          if (action != null) action!,
        ],
      ),
    );
  }
}

class _Num extends StatelessWidget {
  const _Num(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Text.rich(
      TextSpan(
        text: '$label ',
        style: text.labelSmall?.copyWith(color: context.stracker.muted),
        children: <InlineSpan>[
          TextSpan(text: value, style: text.labelMedium?.copyWith(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class _LogRow extends ConsumerWidget {
  const _LogRow({required this.data, required this.test, required this.log});

  final AppData data;
  final TestRecord test;
  final TestErrorLog log;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TextTheme text = Theme.of(context).textTheme;
    final List<String> meta = <String>[
      if (log.subject != null && log.subject!.isNotEmpty) log.subject!,
      if (log.marksLost != null) '${jsNumberText(log.marksLost!)} marks',
      if (log.questions != null) '${log.questions} question${log.questions == 1 ? '' : 's'}',
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(log.category, style: text.titleSmall),
                if (meta.isNotEmpty)
                  Text(meta.join(' · '), style: text.labelSmall?.copyWith(color: context.stracker.muted)),
                if (log.note.isNotEmpty) Text(log.note, style: text.bodySmall),
              ],
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Actions for ${log.category}',
            onSelected: (String action) async {
              if (action == 'edit') {
                await openErrorLogEditor(context, ref, data, test, log);
                return;
              }
              final bool confirmed = await confirmAction(
                context,
                title: 'Remove this classification?',
                message: 'It is removed from the account on the website as well.',
              );
              if (!confirmed) return;
              try {
                await ref.read(dataControllerProvider.notifier).deleteErrorLog(log);
                if (context.mounted) showToast(context, 'Classification removed.');
              } catch (error) {
                if (context.mounted) showToast(context, userMessage(error), error: true);
              }
            },
            itemBuilder: (BuildContext context) => const <PopupMenuEntry<String>>[
              PopupMenuItem<String>(value: 'edit', child: Text('Edit')),
              PopupMenuItem<String>(value: 'delete', child: Text('Delete')),
            ],
          ),
        ],
      ),
    );
  }
}

/// Website ClassifyDialog: category, optional subject, questions, marks lost and a note.
Future<void> openErrorLogEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  TestRecord test,
  TestErrorLog? log,
) async {
  final bool creating = log == null;
  final TextEditingController marks =
      TextEditingController(text: log?.marksLost == null ? '' : jsNumberText(log!.marksLost!));
  final TextEditingController questions = TextEditingController(text: log?.questions?.toString() ?? '');
  final TextEditingController note = TextEditingController(text: log?.note ?? '');
  String category = log?.category ?? 'Silly mistake';
  final List<String> subjects = examSubjectNames(data);
  String? subject = log?.subject;
  if (subject != null && !subjects.contains(subject)) subjects.add(subject);
  String? marksError;
  String? questionsError;
  bool saving = false;

  await showAppSheet<void>(
    context,
    title: creating ? 'Classify lost marks' : 'Edit classification',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppSelect<String?>(
            label: 'Subject',
            value: subject,
            items: <String?>[null, ...subjects],
            labelFor: (String? value) => value ?? 'Not specified',
            onChanged: (String? value) => setSheetState(() => subject = value),
          ),
          AppSelect<String>(
            label: 'Why did it happen?',
            value: category,
            items: errorCategories,
            onChanged: (String? value) => setSheetState(() => category = value ?? category),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: AppField(
                  label: 'Questions',
                  controller: questions,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                  error: questionsError,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppField(
                  label: 'Marks lost',
                  controller: marks,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  error: marksError,
                ),
              ),
            ],
          ),
          AppField(label: 'Note (optional)', controller: note, maxLines: 3, maxLength: 5000),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: <Widget>[
              TextButton(onPressed: () => Navigator.of(sheetContext).pop(), child: const Text('Cancel')),
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: saving
                    ? null
                    : () async {
                        // Website validateErrorLog: marks 0–999999.99 with at most two decimals,
                        // questions a whole number 0–10000.
                        double? marksValue;
                        String? nextMarksError;
                        if (marks.text.trim().isNotEmpty) {
                          final double? parsed = double.tryParse(marks.text.trim());
                          if (parsed == null ||
                              !parsed.isFinite ||
                              parsed < 0 ||
                              parsed > 999999.99 ||
                              (parsed * 100 - (parsed * 100).round()).abs() > 1e-6) {
                            nextMarksError = 'Enter marks lost as a number, 0 or more.';
                          } else {
                            marksValue = parsed;
                          }
                        }
                        int? questionsValue;
                        String? nextQuestionsError;
                        if (questions.text.trim().isNotEmpty) {
                          final int? parsed = int.tryParse(questions.text.trim());
                          if (parsed == null || parsed < 0 || parsed > 10000) {
                            nextQuestionsError = 'Enter a whole number of questions.';
                          } else {
                            questionsValue = parsed;
                          }
                        }
                        setSheetState(() {
                          marksError = nextMarksError;
                          questionsError = nextQuestionsError;
                        });
                        if (nextMarksError != null || nextQuestionsError != null) return;
                        final TestErrorLog next = TestErrorLog(
                          id: log?.id ?? newId(),
                          userId: data.userId,
                          testId: test.id,
                          chapterId: log?.chapterId,
                          subject: subject,
                          category: category,
                          marksLost: marksValue,
                          questions: questionsValue,
                          note: note.text.trim(),
                          createdAt: log?.createdAt ?? isoNow(),
                          updatedAt: isoNow(),
                        );
                        setSheetState(() => saving = true);
                        try {
                          await ref.read(dataControllerProvider.notifier).saveErrorLog(next);
                          if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                          if (context.mounted) {
                            showToast(context, creating ? 'Classification added.' : 'Classification saved.');
                          }
                        } catch (error) {
                          if (context.mounted) showToast(context, userMessage(error), error: true);
                          if (sheetContext.mounted) setSheetState(() => saving = false);
                        }
                      },
                child: Text(creating ? 'Add classification' : 'Save'),
              ),
            ],
          ),
        ],
      ),
    ),
  );
  marks.dispose();
  questions.dispose();
  note.dispose();
}

/// Website TimeDialog: one row per exam subject (minutes, attempted, unattempted), saved
/// with the website's stable ids so both apps update the same rows.
Future<void> openTimeDataEditor(BuildContext context, WidgetRef ref, AppData data, TestRecord test) async {
  final List<TestTimeEntry> existing = data.timeEntries.where((TestTimeEntry e) => e.testId == test.id).toList();
  TestTimeEntry? previousFor(String subject) {
    for (final TestTimeEntry entry in existing) {
      if (entry.subject == subject) return entry;
    }
    return null;
  }

  final List<String> subjects = examSubjectNames(data);
  final Map<String, List<TextEditingController>> fields = <String, List<TextEditingController>>{
    for (final String subject in subjects)
      subject: <TextEditingController>[
        TextEditingController(text: previousFor(subject)?.minutes?.toString() ?? ''),
        TextEditingController(text: previousFor(subject)?.attempted?.toString() ?? ''),
        TextEditingController(text: previousFor(subject)?.unattempted?.toString() ?? ''),
      ],
  };
  String? error;
  bool saving = false;

  await showAppSheet<void>(
    context,
    title: 'Time & attempts by subject',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            'Leave unknown fields blank.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: context.stracker.muted),
          ),
          const SizedBox(height: 8),
          for (final String subject in subjects) ...<Widget>[
            Text(subject, style: Theme.of(context).textTheme.titleSmall),
            Row(
              children: <Widget>[
                for (int i = 0; i < 3; i += 1) ...<Widget>[
                  if (i > 0) const SizedBox(width: 8),
                  Expanded(
                    child: AppField(
                      label: const <String>['Minutes', 'Attempted', 'Unattempted'][i],
                      controller: fields[subject]![i],
                      keyboardType: TextInputType.number,
                      inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                    ),
                  ),
                ],
              ],
            ),
          ],
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                error!,
                style: TextStyle(color: context.stracker.palette.red),
                semanticsLabel: error,
              ),
            ),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: <Widget>[
              TextButton(onPressed: () => Navigator.of(sheetContext).pop(), child: const Text('Cancel')),
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: saving
                    ? null
                    : () async {
                        final List<TestTimeEntry> entries = <TestTimeEntry>[];
                        final String now = isoNow();
                        for (int index = 0; index < subjects.length; index += 1) {
                          final String subject = subjects[index];
                          final List<String> raw =
                              fields[subject]!.map((TextEditingController c) => c.text.trim()).toList();
                          final TestTimeEntry? previous = previousFor(subject);
                          if (raw.every((String value) => value.isEmpty)) {
                            if (previous != null) {
                              entries.add(TestTimeEntry(
                                id: previous.id,
                                userId: previous.userId.isEmpty ? data.userId : previous.userId,
                                testId: test.id,
                                subject: previous.subject,
                                label: previous.label,
                                orderIndex: previous.orderIndex,
                                createdAt: previous.createdAt,
                                updatedAt: now,
                              ));
                            }
                            continue;
                          }
                          final List<int?> values = raw.map((String v) => v.isEmpty ? null : int.tryParse(v)).toList();
                          final bool bad = <int>[0, 1, 2].any((int i) => raw[i].isNotEmpty && values[i] == null) ||
                              (values[0] != null && (values[0]! < 0 || values[0]! > 1440)) ||
                              (values[1] != null && values[1]! < 0) ||
                              (values[2] != null && values[2]! < 0);
                          if (bad) {
                            setSheetState(
                              () => error = 'Use whole numbers for $subject: minutes 0–1440, and counts 0 or more.',
                            );
                            return;
                          }
                          entries.add(TestTimeEntry(
                            // Reuse an older row's id so the app never duplicates a subject.
                            id: previous?.id ?? stableId('${test.id}:time:$subject'),
                            userId: data.userId,
                            testId: test.id,
                            subject: subject,
                            label: '',
                            minutes: values[0],
                            attempted: values[1],
                            unattempted: values[2],
                            orderIndex: index,
                            createdAt: previous?.createdAt ?? now,
                            updatedAt: now,
                          ));
                        }
                        setSheetState(() {
                          error = null;
                          saving = true;
                        });
                        try {
                          for (final TestTimeEntry entry in entries) {
                            await ref.read(dataControllerProvider.notifier).saveTimeEntry(entry);
                          }
                          if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                          if (context.mounted) showToast(context, 'Time data saved.');
                        } catch (failure) {
                          if (context.mounted) showToast(context, 'Could not save time data.', error: true);
                          if (sheetContext.mounted) setSheetState(() => saving = false);
                        }
                      },
                child: const Text('Save time data'),
              ),
            ],
          ),
        ],
      ),
    ),
  );
  for (final List<TextEditingController> list in fields.values) {
    for (final TextEditingController controller in list) {
      controller.dispose();
    }
  }
}
