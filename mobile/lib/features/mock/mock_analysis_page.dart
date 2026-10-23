import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/iterables.dart';
import '../../core/theme/app_theme.dart';
import '../../core/validators.dart';
import '../../core/widgets/charts.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/mock.dart';
import '../shell/app_shell.dart';

/// Mock analysis: error logs by category (with the marks they cost), time per subject
/// with a pacing hint, and the rule-based insights from logic/mock.dart.
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
    final List<TestRecord> mocks = mockTests(data);
    final TestRecord? selected =
        mocks.where((TestRecord test) => test.id == _testId).firstOrNull ?? mocks.firstOrNull;

    return SectionPage(
      title: 'Mock analysis',
      subtitle: mocks.isEmpty ? 'No full mocks recorded yet' : '${mocks.length} mocks',
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          if (mocks.isEmpty)
            const NotebookCard(
              child: EmptyState(
                title: 'No mocks to analyse',
                message: 'Log a Full Mock (or a PYQ paper) in the test journal. Error logs and time '
                    'splits attach to that test.',
                icon: Icons.analytics_outlined,
              ),
            )
          else
            _MockDetail(
              data: data,
              mocks: mocks,
              test: selected!,
              onSelect: (String id) => setState(() => _testId = id),
            ),
        ],
      ),
    );
  }
}

class _MockDetail extends ConsumerWidget {
  const _MockDetail({
    required this.data,
    required this.mocks,
    required this.test,
    required this.onSelect,
  });

  final AppData data;
  final List<TestRecord> mocks;
  final TestRecord test;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final MockAnalysis analysis = analyseMock(data, test);
    final List<TestErrorLog> logs =
        data.errorLogs.where((TestErrorLog row) => row.testId == test.id).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AppSelect<String>(
          label: 'Mock',
          value: test.id,
          items: <String>[for (final TestRecord row in mocks) row.id],
          labelFor: (String id) {
            final TestRecord row = mocks.firstWhere((TestRecord candidate) => candidate.id == id);
            return '${row.title} · ${formatDate(row.testDate)}';
          },
          onChanged: (String? value) {
            if (value != null) onSelect(value);
          },
        ),
        NotebookCard(
          title: test.title,
          subtitle: '${formatDate(test.testDate)} · ${test.testType}',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  ProgressRing(value: analysis.percentage, size: 88),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          percentLabel(analysis.percentage),
                          style: Theme.of(context).textTheme.displaySmall,
                        ),
                        Text(
                          '${numberLabel(analysis.totalLost, digits: 1)} marks accounted for by error logs',
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (analysis.insights.isNotEmpty) ...<Widget>[
                const SizedBox(height: 12),
                for (final String insight in analysis.insights)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Icon(Icons.lightbulb_outline, size: 14, color: colors.palette.accent),
                        const SizedBox(width: 7),
                        Expanded(
                          child: Text(insight, style: Theme.of(context).textTheme.bodySmall),
                        ),
                      ],
                    ),
                  ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 10),
        NotebookCard(
          title: 'Where the marks went',
          subtitle: 'From your error log, per category.',
          trailing: TextButton(
            onPressed: () => openErrorLogEditor(context, ref, data, test, null),
            child: const Text('Add'),
          ),
          child: analysis.byCategory.isEmpty
              ? Text(
                  'No error logs for this mock yet. Log the categories that cost you marks — that is '
                  'what turns a score into a plan.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                )
              : Column(
                  children: <Widget>[
                    BarList(
                      rows: <({String label, double value, String caption})>[
                        for (final CategoryLoss item in analysis.byCategory)
                          (
                            label: item.category,
                            value: analysis.totalLost == 0
                                ? 0
                                : (item.marksLost / analysis.totalLost).clamp(0, 1).toDouble(),
                            caption: '${numberLabel(item.marksLost, digits: 1)} marks · '
                                '${item.entries} log${item.entries == 1 ? '' : 's'}',
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    for (final TestErrorLog log in logs)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: Text(log.category),
                        subtitle: Text(
                          <String>[
                            if (log.subject != null) log.subject!,
                            if (log.chapterId != null) data.chapterName(log.chapterId),
                            if (log.marksLost != null) '${numberLabel(log.marksLost, digits: 1)} marks',
                            if (log.questions != null) '${log.questions} Q',
                            if (log.note.isNotEmpty) log.note,
                          ].join(' · '),
                          style: Theme.of(context).textTheme.labelSmall,
                        ),
                        trailing: IconButton(
                          icon: const Icon(Icons.delete_outline, size: 17),
                          tooltip: 'Delete log',
                          onPressed: () async {
                            final bool confirmed = await confirmAction(
                              context,
                              title: 'Delete this log?',
                              message: 'It is removed from the account on the website as well.',
                            );
                            if (!confirmed) return;
                            try {
                              await ref.read(dataControllerProvider.notifier).deleteErrorLog(log);
                              if (context.mounted) showToast(context, 'Log deleted.');
                            } catch (error) {
                              if (context.mounted) showToast(context, error.toString(), error: true);
                            }
                          },
                        ),
                        onTap: () => openErrorLogEditor(context, ref, data, test, log),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: 10),
        NotebookCard(
          title: 'Time per subject',
          subtitle: 'Minutes and questions you recorded, with pacing against a 180-minute paper.',
          trailing: TextButton(
            onPressed: () => openTimeEntryEditor(context, ref, data, test, null),
            child: const Text('Add'),
          ),
          child: analysis.bySubject.isEmpty
              ? Text(
                  'No time entries yet. Splitting time by subject shows whether one subject is eating '
                  'the paper.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                )
              : Column(
                  children: <Widget>[
                    for (final SubjectTime item in analysis.bySubject)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Row(
                              children: <Widget>[
                                Expanded(
                                  child: Text(item.subject, style: Theme.of(context).textTheme.titleSmall),
                                ),
                                Text(
                                  minutesLabel(item.minutes),
                                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                        color: colors.muted,
                                      ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            LinearBar(
                              value: (item.minutes / 180).clamp(0, 1).toDouble(),
                              height: 6,
                              color: colors.subjectColor(item.subject),
                            ),
                            Text(
                              '${item.attempted} attempted · ${item.unattempted} left',
                              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: colors.muted,
                                  ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

Future<void> openErrorLogEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  TestRecord test,
  TestErrorLog? log,
) async {
  final bool creating = log == null;
  final TextEditingController marks = TextEditingController(
    text: log?.marksLost == null ? '' : numberLabel(log!.marksLost, digits: 1),
  );
  final TextEditingController questions = TextEditingController(text: log?.questions?.toString() ?? '');
  final TextEditingController note = TextEditingController(text: log?.note ?? '');
  String category = log?.category ?? errorCategories.first;
  String? subject = log?.subject;
  String? chapterId = log?.chapterId;
  String? marksError;

  await showAppSheet<void>(
    context,
    title: creating ? 'Log an error' : 'Edit error log',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppSelect<String>(
            label: 'Category',
            value: category,
            items: errorCategories,
            onChanged: (String? value) => setSheetState(() => category = value ?? category),
          ),
          AppSelect<String?>(
            label: 'Subject (optional)',
            value: subject,
            items: <String?>[null, ...data.subjects],
            labelFor: (String? value) => value ?? 'Not set',
            onChanged: (String? value) => setSheetState(() => subject = value),
          ),
          AppSelect<String?>(
            label: 'Chapter (optional)',
            value: chapterId,
            items: <String?>[null, ...data.chapters.map((Chapter chapter) => chapter.id)],
            labelFor: (String? value) => value == null ? 'Not linked' : data.chapterName(value),
            onChanged: (String? value) => setSheetState(() => chapterId = value),
          ),
          Row(
            children: <Widget>[
              Expanded(
                child: AppField(
                  label: 'Marks lost',
                  controller: marks,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  error: marksError,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppField(
                  label: 'Questions',
                  controller: questions,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                ),
              ),
            ],
          ),
          AppField(label: 'Note', controller: note, maxLines: 3, maxLength: 2000),
          ElevatedButton(
            onPressed: () async {
              final double? marksValue =
                  marks.text.trim().isEmpty ? null : double.tryParse(marks.text.trim());
              if (marksValue != null &&
                  (marksValue < 0 || marksValue > 100000 || (marksValue * 100) % 25 != 0)) {
                setSheetState(() => marksError = 'Use 0–100000 in steps of 0.25.');
                return;
              }
              final TestErrorLog next = TestErrorLog(
                id: log?.id ?? newId(),
                userId: data.userId,
                testId: test.id,
                chapterId: chapterId,
                subject: subject,
                category: category,
                marksLost: marksValue,
                questions: int.tryParse(questions.text.trim()),
                note: note.text,
                createdAt: log?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref.read(dataControllerProvider.notifier).saveErrorLog(next);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, creating ? 'Error logged.' : 'Error updated.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: Text(creating ? 'Log error' : 'Save'),
          ),
        ],
      ),
    ),
  );
  marks.dispose();
  questions.dispose();
  note.dispose();
}

Future<void> openTimeEntryEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  TestRecord test,
  TestTimeEntry? entry,
) async {
  final TextEditingController minutes =
      TextEditingController(text: entry?.minutes?.toString() ?? '');
  final TextEditingController attempted =
      TextEditingController(text: entry?.attempted?.toString() ?? '');
  final TextEditingController unattempted =
      TextEditingController(text: entry?.unattempted?.toString() ?? '');
  String? subject = entry?.subject;
  String? minutesError;

  await showAppSheet<void>(
    context,
    title: entry == null ? 'Add time entry' : 'Edit time entry',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppSelect<String?>(
            label: 'Subject',
            value: subject,
            items: <String?>[null, ...data.subjects],
            labelFor: (String? value) => value ?? 'Whole paper',
            onChanged: (String? value) => setSheetState(() => subject = value),
          ),
          AppField(
            label: 'Minutes',
            controller: minutes,
            keyboardType: TextInputType.number,
            inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
            error: minutesError ?? Validators.minutes(minutes.text),
          ),
          Row(
            children: <Widget>[
              Expanded(
                child: AppField(
                  label: 'Attempted',
                  controller: attempted,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppField(
                  label: 'Unattempted',
                  controller: unattempted,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                ),
              ),
            ],
          ),
          ElevatedButton(
            onPressed: () async {
              final String? error = Validators.minutes(minutes.text);
              setSheetState(() => minutesError = error);
              if (error != null) return;
              final TestTimeEntry next = TestTimeEntry(
                id: entry?.id ?? newId(),
                userId: data.userId,
                testId: test.id,
                subject: subject,
                label: subject ?? 'Whole paper',
                minutes: int.tryParse(minutes.text.trim()),
                attempted: int.tryParse(attempted.text.trim()),
                unattempted: int.tryParse(unattempted.text.trim()),
                orderIndex: entry?.orderIndex ?? 0,
                createdAt: entry?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref.read(dataControllerProvider.notifier).saveTimeEntry(next);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, 'Time entry saved.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    ),
  );
  minutes.dispose();
  attempted.dispose();
  unattempted.dispose();
}
