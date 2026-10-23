import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/iterables.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/progress.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// PYQ tracker: one row per chapter × exam × year, inside the year window set in
/// Settings → Exam. Bulk actions mark a whole exam year-range at once.
class PyqPage extends ConsumerStatefulWidget {
  const PyqPage({super.key});

  @override
  ConsumerState<PyqPage> createState() => _PyqPageState();
}

class _PyqPageState extends ConsumerState<PyqPage> {
  final TextEditingController _search = TextEditingController();
  String _exam = 'Main';
  String? _chapterId;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final List<int> years = pyqYears(data.settings);
    final String needle = _search.text.trim().toLowerCase();
    final List<Chapter> chapters = data.chapters
        .where((Chapter chapter) =>
            needle.isEmpty || '${chapter.name} ${chapter.subject}'.toLowerCase().contains(needle))
        .toList();
    final PyqCompletion overall = pyqCompletion(data.pyqRecords, _chapterId, _exam, data.settings);
    final Chapter? selected = data.chapter(_chapterId);

    return SectionPage(
      title: 'PYQs',
      subtitle: '$years first…last: ${years.isEmpty ? '—' : '${years.last}–${years.first}'} · '
          '${percentLabel(overall.percent)} done',
      actions: <Widget>[
        IconButton(
          tooltip: 'PYQ year window',
          icon: const Icon(Icons.date_range, size: 20),
          onPressed: () => Routes.open(context, Routes.settings),
        ),
      ],
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          ChoiceRow<String>(
            label: 'Exam',
            value: _exam,
            options: const <String>['Main', 'Advanced'],
            labelFor: (String value) => pyqExamLabel[value] ?? value,
            onChanged: (String value) => setState(() => _exam = value),
          ),
          SearchBox(
            controller: _search,
            hint: 'Find a chapter',
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 10),
          if (chapters.isEmpty)
            const NotebookCard(
              child: EmptyState(title: 'No chapters match', icon: Icons.search_off),
            )
          else
            for (final Chapter chapter in chapters.take(60))
              _PyqChapterCard(
                chapter: chapter,
                data: data,
                exam: _exam,
                expanded: selected?.id == chapter.id,
                onExpand: () => setState(() => _chapterId = selected?.id == chapter.id ? null : chapter.id),
              ),
          const SizedBox(height: 10),
          InfoBanner(
            'A year counts as done only when a PYQ record for that chapter, exam and year is marked '
            'done. Years with no record stay pending — nothing is assumed.',
          ),
        ],
      ),
    );
  }
}

class _PyqChapterCard extends ConsumerWidget {
  const _PyqChapterCard({
    required this.chapter,
    required this.data,
    required this.exam,
    required this.expanded,
    required this.onExpand,
  });

  final Chapter chapter;
  final AppData data;
  final String exam;
  final bool expanded;
  final VoidCallback onExpand;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final PyqCompletion completion = pyqCompletion(data.pyqRecords, chapter.id, exam, data.settings);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: NotebookCard(
        dense: true,
        onTap: onExpand,
        accent: colors.subjectColor(chapter.subject),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(chapter.name, style: Theme.of(context).textTheme.titleSmall),
                      Text(
                        '${chapter.subject} · ${completion.done}/${completion.total} years done',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                      ),
                    ],
                  ),
                ),
                Text(
                  percentLabel(completion.percent),
                  style: TextStyle(fontFamily: 'PatrickHand', fontSize: 18, color: colors.palette.textAccent),
                ),
                Icon(expanded ? Icons.expand_less : Icons.expand_more, size: 18),
              ],
            ),
            const SizedBox(height: 6),
            LinearBar(value: (completion.percent ?? 0) / 100, height: 5),
            if (expanded) ...<Widget>[
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: <Widget>[
                  for (final int year in pyqYears(data.settings))
                    FilterChip(
                      label: Text('$year'),
                      selected: completion.doneYears.contains(year),
                      onSelected: (bool value) => _toggleYear(context, ref, year, value),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: <Widget>[
                  TextButton.icon(
                    onPressed: () => _bulk(context, ref, true),
                    icon: const Icon(Icons.done_all, size: 16),
                    label: Text('Mark all ${exam.toLowerCase()} years'),
                  ),
                  TextButton.icon(
                    onPressed: () => _bulk(context, ref, false),
                    icon: const Icon(Icons.remove_done, size: 16),
                    label: const Text('Clear'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _toggleYear(BuildContext context, WidgetRef ref, int year, bool done) async {
    final PyqRecord? existing = data.pyqRecords
        .where((PyqRecord record) =>
            record.chapterId == chapter.id && record.exam == exam && record.year == year)
        .firstOrNull;
    final PyqRecord next = PyqRecord(
      id: existing?.id ?? newId(),
      userId: data.userId,
      chapterId: chapter.id,
      exam: exam,
      year: year,
      status: done ? 'done' : 'pending',
      questionsTotal: existing?.questionsTotal,
      questionsDone: existing?.questionsDone,
      completedAt: done ? isoNow() : null,
      createdAt: existing?.createdAt ?? isoNow(),
      updatedAt: isoNow(),
    );
    try {
      await ref.read(dataControllerProvider.notifier).savePyq(next);
    } catch (error) {
      if (context.mounted) showToast(context, error.toString(), error: true);
    }
  }

  Future<void> _bulk(BuildContext context, WidgetRef ref, bool done) async {
    final List<int> years = pyqYears(data.settings);
    final List<PyqRecord> rows = <PyqRecord>[];
    for (final int year in years) {
      final PyqRecord? existing = data.pyqRecords
          .where((PyqRecord record) =>
              record.chapterId == chapter.id && record.exam == exam && record.year == year)
          .firstOrNull;
      rows.add(PyqRecord(
        id: existing?.id ?? newId(),
        userId: data.userId,
        chapterId: chapter.id,
        exam: exam,
        year: year,
        status: done ? 'done' : 'pending',
        completedAt: done ? (existing?.completedAt ?? isoNow()) : null,
        createdAt: existing?.createdAt ?? isoNow(),
        updatedAt: isoNow(),
        questionsTotal: existing?.questionsTotal,
        questionsDone: existing?.questionsDone,
      ));
    }
    try {
      await ref.read(dataControllerProvider.notifier).savePyqMany(rows);
      if (context.mounted) {
        showToast(context, '${chapter.name}: ${done ? 'all' : 'no'} $exam years marked.');
      }
    } catch (error) {
      if (context.mounted) showToast(context, error.toString(), error: true);
    }
  }
}
