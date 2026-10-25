import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/iterables.dart';
import '../../core/theme/app_theme.dart';
import '../../core/validators.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/analytics.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// Test journal: chapter tests, subject tests, full mocks and PYQ practice, with
/// subject scores for mocks and chapter-level links. Validation matches the website's
/// zod schema (half-mark scores, whole totals, no score above its total).
class TestsPage extends ConsumerStatefulWidget {
  const TestsPage({super.key});

  @override
  ConsumerState<TestsPage> createState() => _TestsPageState();
}

class _TestsPageState extends ConsumerState<TestsPage> {
  String _type = 'All';
  String _subject = 'All';

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final MeanResult mean = meanTestPercentage(data.tests, data.testSubjectScores);
    final List<TestRecord> rows = data.tests.where((TestRecord test) {
      final bool matchesType = _type == 'All' || test.testType == _type;
      final bool matchesSubject = _subject == 'All' || test.subject == _subject;
      return matchesType && matchesSubject;
    }).toList()
      ..sort((TestRecord a, TestRecord b) => b.testDate.compareTo(a.testDate));

    return NotebookScaffold(
      title: 'Tests',
      showBrand: true,
      body: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  'Test journal',
                  style: Theme.of(context).textTheme.headlineLarge,
                ),
              ),
              Pill(
                'Avg ${percentLabel(mean.average)}',
                tone: (mean.average ?? 0) >= data.settings.strongThreshold
                    ? PillTone.good
                    : (mean.average ?? 100) < data.settings.weakThreshold
                        ? PillTone.bad
                        : PillTone.neutral,
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${data.tests.length} recorded · ${mean.count} comparable results. Complete Full Mocks use '
            'their subject rows as one aggregate.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
          ),
          const SizedBox(height: 12),
          Row(
            children: <Widget>[
              Expanded(
                child: AppSelect<String>(
                  label: 'Type',
                  value: _type,
                  items: const <String>[
                    'All',
                    'Chapter Test',
                    'Subject Test',
                    'Full Mock',
                    'PYQ Practice',
                  ],
                  onChanged: (String? value) => setState(() => _type = value ?? 'All'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppSelect<String>(
                  label: 'Subject',
                  value: _subject,
                  items: <String>['All', ...data.subjects],
                  onChanged: (String? value) => setState(() => _subject = value ?? 'All'),
                ),
              ),
            ],
          ),
          OutlinedButton.icon(
            onPressed: () => openTestEditor(context, ref, data, null),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Log a test'),
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: data.tests.isEmpty ? 'No tests yet' : 'No tests match the filters',
                message: 'Every score here is one you logged. The notebook never generates example '
                    'scores.',
                icon: Icons.fact_check_outlined,
                action: ElevatedButton(
                  onPressed: () => openTestEditor(context, ref, data, null),
                  child: const Text('Log a test'),
                ),
              ),
            )
          else
            for (final TestRecord test in rows) _TestCard(test: test, data: data),
        ],
      ),
    );
  }
}

class _TestCard extends ConsumerWidget {
  const _TestCard({required this.test, required this.data});

  final TestRecord test;
  final AppData data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final double? percentage = overallTestPercentage(test, data.testSubjectScores);
    final Chapter? chapter = data.chapter(test.chapterId);
    final List<TestSubjectScore> scores =
        data.testSubjectScores.where((TestSubjectScore row) => row.testId == test.id).toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: NotebookCard(
        dense: true,
        onTap: () => openTestEditor(context, ref, data, test),
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
                      Text(test.title, style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 2),
                      Text(
                        '${formatDate(test.testDate)} · ${test.testType}'
                        '${test.subject != null ? ' · ${test.subject}' : ''}'
                        '${chapter != null ? ' · ${chapter.name}' : ''}',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Text(
                      percentLabel(percentage),
                      style: TextStyle(
                        fontFamily: 'PatrickHand',
                        fontSize: 22,
                        color: (percentage ?? 0) >= data.settings.strongThreshold
                            ? colors.palette.green
                            : (percentage ?? 100) < data.settings.weakThreshold
                                ? colors.palette.red
                                : colors.palette.ink,
                      ),
                    ),
                    Text(
                      scoreLabel(test.marksObtained, test.totalMarks),
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                    ),
                  ],
                ),
              ],
            ),
            if (scores.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 7),
                child: Wrap(
                  spacing: 5,
                  runSpacing: 4,
                  children: <Widget>[
                    for (final TestSubjectScore score in scores)
                      Pill(
                        '${score.subject} ${numberLabel(score.marksObtained, digits: 1)}/${numberLabel(score.totalMarks)}',
                        dense: true,
                      ),
                  ],
                ),
              ),
            if (test.correct != null || test.wrong != null || test.skipped != null || test.timeMinutes != null || test.notes.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  <String>[
                    if (test.correct != null) '${test.correct} correct',
                    if (test.wrong != null) '${test.wrong} wrong',
                    if (test.skipped != null) '${test.skipped} skipped',
                    if (test.timeMinutes != null) minutesLabel(test.timeMinutes),
                    if (test.notes.isNotEmpty) test.notes,
                  ].join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

Future<void> openTestEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  TestRecord? test,
) async {
  final bool creating = test == null;
  final TextEditingController title = TextEditingController(text: test?.title ?? '');
  final TextEditingController marks = TextEditingController(
    text: test?.marksObtained == null ? '' : numberLabel(test!.marksObtained, digits: 1),
  );
  final TextEditingController total = TextEditingController(
    text: test?.totalMarks == null ? '' : numberLabel(test!.totalMarks),
  );
  final TextEditingController correct = TextEditingController(text: test?.correct?.toString() ?? '');
  final TextEditingController wrong = TextEditingController(text: test?.wrong?.toString() ?? '');
  final TextEditingController skipped = TextEditingController(text: test?.skipped?.toString() ?? '');
  final TextEditingController totalQuestions = TextEditingController(text: test?.totalQuestions?.toString() ?? '');
  final TextEditingController notes = TextEditingController(text: test?.notes ?? '');
  final TextEditingController timeMinutes =
      TextEditingController(text: test?.timeMinutes?.toString() ?? '');
  final Map<String, TextEditingController> subjectMarks = <String, TextEditingController>{
    for (final String subject in data.subjects)
      subject: TextEditingController(
        text: numberLabel(
          data.testSubjectScores
              .where((TestSubjectScore row) => row.testId == test?.id && row.subject == subject)
              .firstOrNull
              ?.marksObtained,
          empty: '',
        ),
      ),
  };
  final Map<String, TextEditingController> subjectTotals = <String, TextEditingController>{
    for (final String subject in data.subjects)
      subject: TextEditingController(
        text: numberLabel(
          data.testSubjectScores
              .where((TestSubjectScore row) => row.testId == test?.id && row.subject == subject)
              .firstOrNull
              ?.totalMarks,
          empty: '',
        ),
      ),
  };
  String type = test?.testType ?? 'Chapter Test';
  String? subject = test?.subject;
  String? chapterId = test?.chapterId;
  String date = test?.testDate ?? todayIso();
  String? scoreError;

  await showAppSheet<void>(
    context,
    title: creating ? 'Log a test' : 'Edit test',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppField(
            label: 'Test title',
            controller: title,
            required: true,
            maxLength: 160,
            textCapitalization: TextCapitalization.sentences,
          ),
          AppDateField(label: 'Test date', value: date, onChanged: (String? value) {
            if (value != null) setSheetState(() => date = value);
          }),
          ChoiceRow<String>(
            label: 'Test type',
            value: type,
            options: const <String>['Chapter Test', 'Subject Test', 'Full Mock', 'PYQ Practice'],
            onChanged: (String value) => setSheetState(() => type = value),
          ),
          if (type != 'Full Mock') ...<Widget>[
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
          ],
          Row(
            children: <Widget>[
              Expanded(
                child: AppField(
                  label: 'Marks obtained',
                  controller: marks,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  error: Validators.marksObtained(marks.text),
                  helper: 'Half-point steps.',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppField(
                  label: 'Total marks',
                  controller: total,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                  error: Validators.totalMarks(total.text),
                ),
              ),
            ],
          ),
          if (type == 'Full Mock') ...<Widget>[
            const SectionHeading('Subject scores', padding: EdgeInsets.only(bottom: 6)),
            const InfoBanner(
              'Full Mock records marks separately for each subject. Subject and chapter selection do not apply.',
            ),
            const SizedBox(height: 8),
            InfoBanner(
              data.subjects.length == 3
                  ? 'A complete Full Mock needs all three subject rows; they become one aggregate result.'
                  : 'Subject rows are saved as entered; the aggregate uses whatever distinct subjects you fill.',
            ),
            const SizedBox(height: 8),
            for (final String subjectName in data.subjects)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      flex: 3,
                      child: Text(subjectName, style: Theme.of(context).textTheme.bodySmall),
                    ),
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: subjectMarks[subjectName],
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(labelText: 'Marks', isDense: true),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: subjectTotals[subjectName],
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Total', isDense: true),
                      ),
                    ),
                  ],
                ),
              ),
          ],
          Row(
            children: <Widget>[
              Expanded(
                child: AppField(
                  label: 'Correct',
                  controller: correct,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppField(
                  label: 'Wrong',
                  controller: wrong,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppField(
                  label: 'Skipped',
                  controller: skipped,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                ),
              ),
            ],
          ),
          AppField(
            label: 'Total questions (optional)',
            controller: totalQuestions,
            keyboardType: TextInputType.number,
            inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
          ),
          AppField(
            label: 'Time taken (minutes)',
            controller: timeMinutes,
            keyboardType: TextInputType.number,
            inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
          ),
          AppField(label: 'Notes', controller: notes, maxLines: 3, maxLength: 10000),
          if (scoreError != null) ...<Widget>[
            ErrorNotice(scoreError!),
            const SizedBox(height: 8),
          ],
          ElevatedButton(
            onPressed: () async {
              final double? marksValue =
                  marks.text.trim().isEmpty ? null : double.tryParse(marks.text.trim());
              final double? totalValue =
                  total.text.trim().isEmpty ? null : double.tryParse(total.text.trim());
              final String? pairError = Validators.scorePair(marksValue, totalValue) ??
                  Validators.questionCounts(
                    int.tryParse(correct.text.trim()),
                    int.tryParse(wrong.text.trim()),
                    int.tryParse(skipped.text.trim()),
                    int.tryParse(totalQuestions.text.trim()),
                  );
              setSheetState(() => scoreError = pairError);
              if (title.text.trim().isEmpty || pairError != null) {
                if (title.text.trim().isEmpty) {
                  setSheetState(() => scoreError = 'Test title is required.');
                }
                return;
              }
              final String testId = test?.id ?? newId();
              final TestRecord next = TestRecord(
                id: testId,
                userId: data.userId,
                title: title.text.trim(),
                testDate: date,
                testType: type,
                subject: type == 'Full Mock' ? null : subject,
                chapterId: type == 'Full Mock' ? null : chapterId,
                marksObtained: marksValue,
                totalMarks: totalValue,
                correct: int.tryParse(correct.text.trim()),
                wrong: int.tryParse(wrong.text.trim()),
                skipped: int.tryParse(skipped.text.trim()),
                totalQuestions: int.tryParse(totalQuestions.text.trim()),
                negativeMarks: test?.negativeMarks,
                timeMinutes: int.tryParse(timeMinutes.text.trim()),
                notes: notes.text,
                createdAt: test?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              final List<TestSubjectScore> scores = <TestSubjectScore>[];
              if (type == 'Full Mock') {
                for (final String subjectName in data.subjects) {
                  final double? subjectMark = double.tryParse(subjectMarks[subjectName]!.text.trim());
                  final double? subjectTotal = double.tryParse(subjectTotals[subjectName]!.text.trim());
                  if (subjectMark == null && subjectTotal == null) continue;
                  if (Validators.scorePair(subjectMark, subjectTotal) != null) {
                    setSheetState(() => scoreError =
                        'Check the $subjectName marks: a score needs a total and cannot exceed it.');
                    return;
                  }
                  final TestSubjectScore? existing = data.testSubjectScores
                      .where((TestSubjectScore row) =>
                          row.testId == testId && row.subject == subjectName)
                      .firstOrNull;
                  scores.add(TestSubjectScore(
                    id: existing?.id ?? newId(),
                    userId: data.userId,
                    testId: testId,
                    subject: subjectName,
                    marksObtained: subjectMark,
                    totalMarks: subjectTotal,
                    createdAt: existing?.createdAt ?? isoNow(),
                    updatedAt: isoNow(),
                  ));
                }
              }
              try {
                await ref
                    .read(dataControllerProvider.notifier)
                    .saveTest(next, subjectScores: scores);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, creating ? 'Test logged.' : 'Test updated.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: Text(creating ? 'Log test' : 'Save changes'),
          ),
          if (!creating)
            Row(
              children: <Widget>[
                Expanded(
                  child: TextButton(
                    onPressed: () {
                      Navigator.of(sheetContext).pop();
                      Routes.open(context, Routes.mockAnalysis);
                    },
                    child: const Text('Mock analysis'),
                  ),
                ),
                Expanded(
                  child: TextButton(
                    onPressed: () async {
                      final bool confirmed = await confirmAction(
                        context,
                        title: 'Delete this test?',
                        message: 'Its subject scores, chapter links and mock notes are removed with it.',
                      );
                      if (!confirmed) return;
                      try {
                        await ref.read(dataControllerProvider.notifier).deleteTest(test);
                        if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                        if (context.mounted) showToast(context, 'Test deleted.');
                      } catch (error) {
                        if (context.mounted) showToast(context, error.toString(), error: true);
                      }
                    },
                    child: Text('Delete', style: TextStyle(color: context.stracker.palette.red)),
                  ),
                ),
              ],
            ),
        ],
      ),
    ),
  );
  title.dispose();
  marks.dispose();
  total.dispose();
  correct.dispose();
  wrong.dispose();
  skipped.dispose();
  totalQuestions.dispose();
  notes.dispose();
  timeMinutes.dispose();
  for (final TextEditingController controller in subjectMarks.values) {
    controller.dispose();
  }
  for (final TextEditingController controller in subjectTotals.values) {
    controller.dispose();
  }
}
