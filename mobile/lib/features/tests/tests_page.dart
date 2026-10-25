import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/iterables.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/analytics.dart';
import '../../logic/marking.dart';
import '../../logic/test_form.dart';
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
  String _sort = 'Newest first';
  String? _from;
  String? _to;
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final MeanResult mean = meanTestPercentage(data.tests, data.testSubjectScores);
    final String term = _search.text.trim().toLowerCase();
    // Like the website: a Full Mock spans every subject, so it stays under every subject
    // filter, and search also matches its "All subjects" label and the chapter name.
    final List<TestRecord> rows = data.tests.where((TestRecord test) {
      final String shownSubject = test.testType == 'Full Mock' ? 'All subjects' : (test.subject ?? '');
      final String chapterName = test.chapterId == null ? '' : (data.chapter(test.chapterId)?.name ?? '');
      if (term.isNotEmpty &&
          !'${test.title} ${test.testType} ${test.notes} $shownSubject $chapterName'.toLowerCase().contains(term)) {
        return false;
      }
      if (_type != 'All' && test.testType != _type) return false;
      if (_subject != 'All' && test.testType != 'Full Mock' && test.subject != _subject) return false;
      if (_from != null && test.testDate.compareTo(_from!) < 0) return false;
      if (_to != null && test.testDate.compareTo(_to!) > 0) return false;
      return true;
    }).toList()
      ..sort((TestRecord a, TestRecord b) {
        switch (_sort) {
          case 'Oldest first':
            return a.testDate.compareTo(b.testDate);
          case 'Title A–Z':
            return a.title.toLowerCase().compareTo(b.title.toLowerCase());
          case 'Highest score':
            return (overallTestPercentage(b, data.testSubjectScores) ?? -1)
                .compareTo(overallTestPercentage(a, data.testSubjectScores) ?? -1);
          default:
            return b.testDate.compareTo(a.testDate);
        }
      });
    final bool filtered = term.isNotEmpty || _type != 'All' || _subject != 'All' || _from != null || _to != null;

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
          AppField(
            label: 'Search tests',
            controller: _search,
            hint: 'Title, type, notes, subject or chapter',
            prefix: Icons.search,
            suffix: _search.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear search',
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => setState(_search.clear),
                  ),
            onChanged: (_) => setState(() {}),
          ),
          Row(
            children: <Widget>[
              Expanded(
                child: AppDateField(
                  label: 'From',
                  allowClear: true,
                  value: _from,
                  onChanged: (String? value) => setState(() => _from = value),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppDateField(
                  label: 'To',
                  allowClear: true,
                  value: _to,
                  onChanged: (String? value) => setState(() => _to = value),
                ),
              ),
            ],
          ),
          AppSelect<String>(
            label: 'Sort',
            value: _sort,
            items: const <String>['Newest first', 'Oldest first', 'Title A–Z', 'Highest score'],
            onChanged: (String? value) => setState(() => _sort = value ?? _sort),
          ),
          if (filtered)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => setState(() {
                  _search.clear();
                  _type = 'All';
                  _subject = 'All';
                  _from = null;
                  _to = null;
                }),
                icon: const Icon(Icons.filter_alt_off_outlined, size: 17),
                label: Text('Clear filters · ${rows.length} of ${data.tests.length} shown'),
              ),
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
                        '${test.testType == 'Full Mock' ? ' · All subjects' : test.subject != null ? ' · ${test.subject}' : ''}'
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
            if (test.correct != null ||
                test.wrong != null ||
                test.skipped != null ||
                test.timeMinutes != null ||
                test.notes.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  <String>[
                    if (test.correct != null) '${test.correct} correct',
                    if (test.wrong != null) '${test.wrong} wrong',
                    if (test.skipped != null) '${test.skipped} skipped',
                    if (test.totalQuestions != null) '${test.totalQuestions} questions',
                    if (test.negativeMarks != null) '−${numberLabel(test.negativeMarks, digits: 2)} negative',
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
  TestRecord? test, {
  String? presetChapterId,
}) async {
  final bool creating = test == null;
  final String testId = test?.id ?? newId();
  final MarkingScheme? scheme = markingSchemeFor(data);
  final bool jee = isJeeExam(data.settings.examId);
  final List<String> mockSubjects = examSubjectNames(data);
  final List<String> formSubjects = examSubjectsWith(data, test?.subject);
  final List<TestSubjectScore> oldScores = test == null
      ? const <TestSubjectScore>[]
      : data.testSubjectScores.where((TestSubjectScore s) => s.testId == test.id).toList();
  final Chapter? preset = creating && presetChapterId != null ? data.chapter(presetChapterId) : null;
  String jeePattern = inferJeePattern(test?.testType, oldScores);

  String text(num? value) => value == null ? '' : numberLabel(value, digits: 2);
  final TextEditingController title = TextEditingController(text: test?.title ?? '');
  final TextEditingController marks = TextEditingController(text: text(test?.marksObtained));
  final TextEditingController total = TextEditingController(
    text: test != null ? text(test.totalMarks) : defaultTotalFor(scheme, 'Chapter Test', preset?.subject),
  );
  final TextEditingController correct = TextEditingController(text: test?.correct?.toString() ?? '');
  final TextEditingController wrong = TextEditingController(text: test?.wrong?.toString() ?? '');
  final TextEditingController skipped = TextEditingController(text: test?.skipped?.toString() ?? '');
  final TextEditingController questions = TextEditingController(text: test?.totalQuestions?.toString() ?? '');
  final TextEditingController negative = TextEditingController(text: text(test?.negativeMarks));
  final TextEditingController time = TextEditingController(text: test?.timeMinutes?.toString() ?? '');
  final TextEditingController notes = TextEditingController(text: test?.notes ?? '');

  // Full Mock rows: label -> (marks, total) controllers, pre-filled from the marking scheme.
  final Map<String, (TextEditingController, TextEditingController)> mock =
      <String, (TextEditingController, TextEditingController)>{};
  void resetMock(Map<String, String> defaults, {Map<String, String> keepMarks = const <String, String>{}}) {
    final Map<String, (TextEditingController, TextEditingController)> previous =
        Map<String, (TextEditingController, TextEditingController)>.of(mock);
    mock.clear();
    defaults.forEach((String row, String defTotal) {
      mock[row] = (TextEditingController(text: keepMarks[row] ?? ''), TextEditingController(text: defTotal));
    });
    for (final (TextEditingController m, TextEditingController t) in previous.values) {
      m.dispose();
      t.dispose();
    }
  }

  final List<String> baseSubjects = jeePattern == 'advanced-both'
      ? mockSubjects
      : <String>{...mockSubjects, ...oldScores.map((TestSubjectScore s) => s.subject)}.toList();
  resetMock(fullMockDefaults(scheme, baseSubjects, jeePattern));
  for (final TestSubjectScore score in oldScores) {
    final (TextEditingController, TextEditingController) row =
        mock[score.subject] ?? (TextEditingController(), TextEditingController());
    row.$1.text = text(score.marksObtained);
    row.$2.text = text(score.totalMarks);
    mock[score.subject] = row;
  }

  String type = test?.testType ?? 'Chapter Test';
  String? subject = test?.subject ?? preset?.subject;
  String? chapterId = test?.chapterId ?? preset?.id;
  String date = test?.testDate ?? todayIso();
  Map<String, String> errors = <String, String>{};
  bool saving = false;

  await showAppSheet<void>(
    context,
    title: creating ? 'Log a test' : 'Edit test record',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) {
        final bool fullMock = type == 'Full Mock';
        final TextTheme textTheme = Theme.of(context).textTheme;
        final StrackerColors colors = context.stracker;
        void clear(String key) {
          if (errors.containsKey(key) || errors.containsKey('_form')) {
            setSheetState(() => errors = <String, String>{...errors}
              ..remove(key)
              ..remove('_form'));
          }
        }

        Widget number(String label, TextEditingController controller, String key,
                {bool decimal = false, String? hint, String? helper}) =>
            AppField(
              label: label,
              controller: controller,
              hint: hint,
              helper: helper,
              error: errors[key],
              keyboardType: TextInputType.numberWithOptions(decimal: decimal),
              inputFormatters: <TextInputFormatter>[
                decimal ? FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')) : FilteringTextInputFormatter.digitsOnly,
              ],
              onChanged: (_) => clear(key),
            );

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text('Record only what you know. Leave unknown values blank.',
                  style: textTheme.bodySmall?.copyWith(color: colors.muted)),
            ),
            if (errors['_form'] != null) ...<Widget>[ErrorNotice(errors['_form']!), const SizedBox(height: 8)],
            AppField(
              label: 'Test title',
              controller: title,
              required: true,
              maxLength: 160,
              hint: 'e.g. Electrostatics weekly test',
              error: errors['title'],
              helper: title.text.length >= 120
                  ? '${title.text.length}/160 characters — long titles are trimmed with an ellipsis in lists'
                  : null,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) {
                setSheetState(() {});
                clear('title');
              },
            ),
            AppDateField(
              label: 'Date',
              value: date,
              onChanged: (String? value) {
                if (value != null) setSheetState(() => date = value);
              },
            ),
            AppSelect<String>(
              label: 'Test type',
              value: type,
              items: const <String>['Chapter Test', 'Subject Test', 'Full Mock', 'PYQ Practice'],
              onChanged: (String? value) {
                if (value == null) return;
                setSheetState(() {
                  type = value;
                  errors = <String, String>{...errors}..remove('_form');
                  if (value == 'Full Mock') {
                    final Map<String, String> keep = <String, String>{
                      for (final MapEntry<String, (TextEditingController, TextEditingController)> e in mock.entries)
                        e.key: e.value.$1.text,
                    };
                    final Map<String, String> defaults = fullMockDefaults(scheme, mockSubjects, jeePattern);
                    final Map<String, String> keepTotals = <String, String>{
                      for (final MapEntry<String, (TextEditingController, TextEditingController)> e in mock.entries)
                        if (e.value.$1.text.isNotEmpty || e.value.$2.text.isNotEmpty) e.key: e.value.$2.text,
                    };
                    resetMock(<String, String>{...defaults, ...keepTotals}, keepMarks: keep);
                  } else if (creating) {
                    total.text = defaultTotalFor(scheme, value, subject);
                  }
                });
              },
            ),
            if (!fullMock) ...<Widget>[
              AppOptionSelect<String>(
                label: 'Subject',
                value: subject,
                nullLabel: '— choose subject —',
                options: <SelectOption<String>>[for (final String s in formSubjects) SelectOption<String>(s, s)],
                onChanged: (String? value) => setSheetState(() {
                  subject = value;
                  chapterId = null;
                  if (creating) total.text = defaultTotalFor(scheme, type, value);
                }),
              ),
              if (preset != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: InfoBanner('Chapter preselected from Weak areas: ${preset.name} (${preset.subject})'),
                ),
              AppOptionSelect<String>(
                label: 'Chapter (optional)',
                value: chapterId,
                nullLabel: '— choose chapter —',
                error: errors['chapter_id'],
                options: <SelectOption<String>>[
                  for (final Chapter c in data.chapters.where((Chapter c) => subject == null || c.subject == subject))
                    SelectOption<String>(c.id, c.name),
                ],
                onChanged: (String? value) {
                  setSheetState(() => chapterId = value);
                  clear('chapter_id');
                },
              ),
            ],
            if (jee && fullMock)
              AppSelect<String>(
                label: 'JEE paper pattern',
                value: jeePattern,
                items: jeeFullPatterns.keys.toList(),
                labelFor: (String v) => jeeFullPatterns[v]!,
                onChanged: (String? value) {
                  if (value == null) return;
                  setSheetState(() {
                    final Map<String, String> keep = <String, String>{};
                    final Map<String, String> defaults = fullMockDefaults(scheme, mockSubjects, value);
                    for (final String row in defaults.keys) {
                      final String? previous = mock[row]?.$1.text ??
                          (value == 'advanced-both'
                              ? mock[scoreSubjectBase(row)]?.$1.text
                              : mock['$row — Paper 1']?.$1.text);
                      if (previous != null) keep[row] = previous;
                    }
                    jeePattern = value;
                    resetMock(defaults, keepMarks: keep);
                  });
                },
              ),
            if (scheme != null && fullMock)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Text(
                  'Marking defaults: ${scheme.source}. Totals are pre-filled and can be edited.'
                  '${scheme.notes != null ? ' ${scheme.notes}' : ''}',
                  style: textTheme.bodySmall?.copyWith(color: colors.muted),
                ),
              ),
            if (fullMock) ...<Widget>[
              const SectionHeading('Subject scores', padding: EdgeInsets.only(bottom: 4)),
              Text('(enter each result that you have)', style: textTheme.labelSmall?.copyWith(color: colors.muted)),
              const SizedBox(height: 6),
              const InfoBanner(fullMockScopeHint),
              const SizedBox(height: 6),
              Text(
                'The overall result sums every subject. Each subject score is checked against its own total; '
                'leave unknown scores blank.',
                style: textTheme.bodySmall?.copyWith(color: colors.muted),
              ),
              const SizedBox(height: 8),
              for (final MapEntry<String, (TextEditingController, TextEditingController)> row in mock.entries)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        flex: 3,
                        child: Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Text(row.key, style: textTheme.bodySmall),
                        ),
                      ),
                      Expanded(
                        flex: 2,
                        child: TextField(
                          controller: row.value.$1,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                          onChanged: (_) => clear('${row.key}.marks'),
                          decoration: InputDecoration(
                            hintText: 'Marks',
                            isDense: true,
                            errorText: errors['${row.key}.marks'],
                            errorMaxLines: 3,
                            semanticCounterText: '${row.key} marks',
                          ),
                        ),
                      ),
                      const Padding(padding: EdgeInsets.fromLTRB(4, 12, 4, 0), child: Text('/')),
                      Expanded(
                        flex: 2,
                        child: TextField(
                          controller: row.value.$2,
                          keyboardType: TextInputType.number,
                          inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                          onChanged: (_) => clear('${row.key}.total'),
                          decoration: InputDecoration(
                            hintText: 'Total',
                            isDense: true,
                            errorText: errors['${row.key}.total'],
                            errorMaxLines: 3,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
            ] else
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                      child: number('Marks obtained', marks, 'marks', decimal: true, hint: 'Leave blank if unknown')),
                  const SizedBox(width: 8),
                  Expanded(child: number('Total marks', total, 'total', hint: 'e.g. 120')),
                ],
              ),
            number('Total questions (optional)', questions, 'questions',
                hint: 'e.g. 50', helper: 'Correct + wrong + skipped must fit within this.'),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(child: number('Correct', correct, 'correct', hint: '—')),
                const SizedBox(width: 8),
                Expanded(child: number('Wrong', wrong, 'wrong', hint: '—')),
                const SizedBox(width: 8),
                Expanded(child: number('Skipped', skipped, 'skipped', hint: '—')),
              ],
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                    child: number('Negative marks', negative, 'negative_marks', decimal: true, hint: 'No estimate')),
                const SizedBox(width: 8),
                Expanded(child: number('Time taken (minutes)', time, 'time_minutes', hint: 'Optional')),
              ],
            ),
            AppField(
              label: 'Notes',
              controller: notes,
              maxLines: 3,
              maxLength: 10000,
              hint: 'What felt easy? What deserves another look?',
              error: errors['notes'],
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: <Widget>[
                TextButton(
                  onPressed: saving ? null : () => Navigator.of(sheetContext).pop(),
                  child: const Text('Cancel'),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: saving
                      ? null
                      : () async {
                          final DataController controller = ref.read(dataControllerProvider.notifier);
                          final AppData current = ref.read(dataControllerProvider).data;
                          final TestSaveResult result = buildTestSave(
                            input: TestFormInput(
                              title: title.text,
                              date: date,
                              type: type,
                              subject: subject,
                              chapterId: chapterId,
                              marks: marks.text,
                              total: total.text,
                              correct: correct.text,
                              wrong: wrong.text,
                              skipped: skipped.text,
                              questions: questions.text,
                              negative: negative.text,
                              time: time.text,
                              notes: notes.text,
                              mockScores: <String, ({String marks, String total})>{
                                for (final MapEntry<String, (TextEditingController, TextEditingController)> e
                                    in mock.entries)
                                  e.key: (marks: e.value.$1.text, total: e.value.$2.text),
                              },
                            ),
                            testId: testId,
                            userId: current.userId,
                            chapters: current.chapters,
                            existingScores:
                                current.testSubjectScores.where((TestSubjectScore s) => s.testId == testId).toList(),
                            existingLinks:
                                current.testChapterLinks.where((TestChapterLink l) => l.testId == testId).toList(),
                            existing: current.tests.where((TestRecord t) => t.id == testId).firstOrNull,
                            now: isoNow(),
                          );
                          if (!result.ok) {
                            setSheetState(() => errors = result.errors);
                            showToast(context, 'Please correct the highlighted test fields.', error: true);
                            await HapticFeedback.mediumImpact();
                            return;
                          }
                          setSheetState(() => saving = true);
                          try {
                            await controller.saveTest(
                              result.test!,
                              subjectScores: type == 'Full Mock' ? result.scores : const <TestSubjectScore>[],
                              chapterLink: result.link,
                              replaceChapterLinks: true,
                            );
                            await HapticFeedback.lightImpact();
                            if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                            if (context.mounted) {
                              showToast(context,
                                  creating ? 'Test saved. Your history starts here.' : 'Test details updated.');
                            }
                          } catch (error) {
                            if (context.mounted) {
                              showToast(context, error is AppFailure ? error.message : 'Could not save test. Retry.',
                                  error: true);
                            }
                            setSheetState(() => saving = false);
                          }
                        },
                  child: Text(saving ? 'Saving…' : (creating ? 'Save test' : 'Save changes')),
                ),
              ],
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
                          if (context.mounted) showToast(context, 'Could not delete test.', error: true);
                        }
                      },
                      child: Text('Delete', style: TextStyle(color: context.stracker.palette.red)),
                    ),
                  ),
                ],
              ),
          ],
        );
      },
    ),
  );
  for (final TextEditingController c in <TextEditingController>[
    title,
    marks,
    total,
    correct,
    wrong,
    skipped,
    questions,
    negative,
    time,
    notes,
  ]) {
    c.dispose();
  }
  for (final (TextEditingController m, TextEditingController t) in mock.values) {
    m.dispose();
    t.dispose();
  }
}
