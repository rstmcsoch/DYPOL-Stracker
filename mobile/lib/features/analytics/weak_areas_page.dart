import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/analytics.dart';
import '../../logic/progress.dart';
import '../practice/practice_page.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';
import '../tests/tests_page.dart';

/// Website `WeakAreasPage`: the threshold banner, four overview counts, the practice signal,
/// the "dip worth checking" alert, tested chapters (worst first, dropping on top) and the
/// untested chapters, which are never classified as weak.
class WeakAreasPage extends ConsumerStatefulWidget {
  const WeakAreasPage({super.key});

  @override
  ConsumerState<WeakAreasPage> createState() => _WeakAreasPageState();
}

class _WeakAreasPageState extends ConsumerState<WeakAreasPage> {
  static const int _mobileVisibleLimit = 8;

  String _subject = 'all';
  bool _showAllTested = false;
  bool _showUntested = false;

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final AppSettings settings = data.settings;
    final List<String> subjects = data.subjects;
    final String subject = _subject == 'all' || subjects.contains(_subject) ? _subject : 'all';
    bool inSubject(Chapter chapter) => subject == 'all' || chapter.subject == subject;

    final List<ChapterPerformance> chapters =
        chapterPerformance(data).where((ChapterPerformance item) => inSubject(item.chapter)).toList();
    final List<ChapterPerformance> untested =
        chapters.where((ChapterPerformance item) => item.classification == 'Untested').toList()
          ..sort((ChapterPerformance a, ChapterPerformance b) {
            final int bySubject = a.chapter.subject.compareTo(b.chapter.subject);
            return bySubject != 0 ? bySubject : a.chapter.position.compareTo(b.chapter.position);
          });
    final List<ChapterPerformance> tested =
        chapters.where((ChapterPerformance item) => item.classification != 'Untested').toList()
          ..sort((ChapterPerformance a, ChapterPerformance b) {
            final int byDrop = (b.dropping ? 1 : 0) - (a.dropping ? 1 : 0);
            return byDrop != 0 ? byDrop : (a.average ?? 100).compareTo(b.average ?? 100);
          });
    final int weak = tested.where((ChapterPerformance item) => item.classification == 'Weak').length;
    final int strong = tested.where((ChapterPerformance item) => item.classification == 'Strong').length;
    final List<ChapterPerformance> dropping = tested.where((ChapterPerformance item) => item.dropping).toList();
    final Map<String, PracticeAggregate> practice = practiceByChapter(data);
    // Practice is a second, independent signal: low accuracy on enough questions, or many misses.
    final List<(Chapter, PracticeAggregate)> practiceWeak = <(Chapter, PracticeAggregate)>[
      for (final Chapter chapter in data.chapters)
        if (inSubject(chapter) && practice[chapter.id] != null) (chapter, practice[chapter.id]!),
    ]
        .where(((Chapter, PracticeAggregate) item) =>
            item.$2.attempted >= practiceMinAttemptsForSignal &&
            item.$2.accuracy != null &&
            (item.$2.accuracy! < settings.weakThreshold || item.$2.incorrect >= 40))
        .toList()
      ..sort((a, b) => (a.$2.accuracy ?? 0).compareTo(b.$2.accuracy ?? 0));
    final List<ChapterPerformance> shownTested = _showAllTested ? tested : tested.take(_mobileVisibleLimit).toList();
    final String weakT = numberLabel(settings.weakThreshold);
    final String strongT = numberLabel(settings.strongThreshold);

    return SectionPage(
      title: 'Weak areas',
      subtitle: 'Averages of the last three usable results.',
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          Row(
            children: <Widget>[
              Text('Subject', style: text.labelMedium),
              const SizedBox(width: 10),
              Flexible(
                child: DropdownButton<String>(
                  value: subject,
                  isExpanded: true,
                  items: <DropdownMenuItem<String>>[
                    const DropdownMenuItem<String>(value: 'all', child: Text('All subjects')),
                    for (final String item in subjects)
                      DropdownMenuItem<String>(value: item, child: Text(item, overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (String? value) => setState(() {
                    _subject = value ?? 'all';
                    _showAllTested = false;
                    _showUntested = false;
                  }),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          NotebookCard(
            dense: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text.rich(
                  TextSpan(
                    children: <InlineSpan>[
                      const TextSpan(text: '✎  Current bands: '),
                      TextSpan(text: 'Weak < $weakT%', style: const TextStyle(fontWeight: FontWeight.w700)),
                      const TextSpan(text: '  ·  '),
                      TextSpan(text: 'Okay $weakT–$strongT%', style: const TextStyle(fontWeight: FontWeight.w700)),
                      const TextSpan(text: '  ·  '),
                      TextSpan(text: 'Strong > $strongT%', style: const TextStyle(fontWeight: FontWeight.w700)),
                    ],
                  ),
                  style: text.bodySmall,
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => Routes.open(context, Routes.settings),
                    child: const Text('Adjust in Settings ↗'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          WrapGrid(
            minItemWidth: 150,
            children: <Widget>[
              _Overview(
                icon: Icons.warning_amber_rounded,
                eyebrow: 'NEEDS ANOTHER LOOK',
                value: weak,
                caption: 'chapter${weak == 1 ? '' : 's'} below the weak-area threshold',
                tone: colors.palette.red,
              ),
              _Overview(
                icon: Icons.trending_down,
                eyebrow: 'DROPPING',
                value: dropping.length,
                caption: 'latest result fell by ${numberLabel(settings.droppingThreshold)} points or more',
                tone: colors.palette.orange,
              ),
              _Overview(
                icon: Icons.track_changes,
                eyebrow: 'NO BASELINE YET',
                value: untested.length,
                caption: 'untested · not classified as weak',
                tone: colors.muted,
              ),
              _Overview(
                icon: Icons.trending_up,
                eyebrow: 'FEELING STEADY',
                value: strong,
                caption: 'chapter${strong == 1 ? '' : 's'} at or above the strong threshold',
                tone: colors.palette.green,
              ),
            ],
          ),
          if (practiceWeak.isNotEmpty) ...<Widget>[
            const _Heading(
                'Practice is flagging these', 'From your DPP and module log. Needs 20+ questions per chapter.'),
            NotebookCard(
              child: Column(
                children: <Widget>[
                  for (final (Chapter chapter, PracticeAggregate agg) in practiceWeak)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(chapter.name, style: text.titleSmall),
                          Text(
                            '${agg.attempted} questions · ${agg.incorrect} incorrect · recent '
                            '${percentLabel(agg.recentAccuracy)}',
                            style: text.labelSmall?.copyWith(color: colors.muted),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: <Widget>[
                              Expanded(
                                child: LinearBar(
                                  value: ((agg.accuracy ?? 0).clamp(0, 100)) / 100,
                                  color: colors.palette.orange,
                                  label: '${chapter.name} practice accuracy',
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(percentLabel(agg.accuracy), style: text.titleSmall),
                            ],
                          ),
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton(
                              onPressed: () =>
                                  openPracticeEditor(context, ref, data, null, presetChapterId: chapter.id),
                              child: const Text('Log practice ↗'),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
          if (dropping.isNotEmpty) ...<Widget>[
            const SizedBox(height: 10),
            NotebookCard(
              accent: colors.palette.orange,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Icon(Icons.south_east, size: 18, color: colors.palette.orange),
                      const SizedBox(width: 6),
                      Text('A dip worth checking', style: text.titleSmall),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    dropping
                        .map((ChapterPerformance item) =>
                            '${item.chapter.name} (${(item.results.length > 1 ? item.results[1].percentage : 0).round()}% → '
                            '${(item.latest ?? 0).round()}%)')
                        .join(' · '),
                    style: text.bodySmall,
                  ),
                  const SizedBox(height: 4),
                  Text('Compare the paper, not just the score.', style: text.labelSmall?.copyWith(color: colors.muted)),
                ],
              ),
            ),
          ],
          _Heading('Tested chapters', '${tested.length} chapter${tested.length == 1 ? '' : 's'} with usable scores'),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                if (tested.isEmpty)
                  EmptyState(
                    title: 'No usable chapter results yet.',
                    icon: Icons.track_changes,
                    action: OutlinedButton(
                      onPressed: () => openTestEditor(context, ref, data, null),
                      child: const Text('Add a chapter test'),
                    ),
                  )
                else
                  for (final ChapterPerformance item in shownTested) _TestedRow(item: item),
                if (tested.length > _mobileVisibleLimit)
                  TextButton.icon(
                    onPressed: () {
                      HapticFeedback.selectionClick();
                      setState(() => _showAllTested = !_showAllTested);
                    },
                    icon: Icon(_showAllTested ? Icons.expand_less : Icons.expand_more, size: 16),
                    label: Text(
                        _showAllTested ? 'Show fewer tested chapters' : 'Show all ${tested.length} tested chapters'),
                  ),
                const SizedBox(height: 6),
                Text(
                  'Chapter score = mean of the latest three usable chapter results. Percentages normalize '
                  'different test totals.',
                  style: text.labelSmall?.copyWith(color: colors.muted),
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => Routes.open(context, Routes.tests),
                    child: const Text('Test history ↗'),
                  ),
                ),
              ],
            ),
          ),
          _Heading(
            'Untested chapters',
            'A baseline is missing — not a reason to assume weakness.',
            trailing: Pill('${untested.length} untested', dense: true),
          ),
          NotebookCard(
            child: untested.isEmpty
                ? EmptyState(
                    title: data.chapters.isNotEmpty ? 'Every chapter has a recorded result.' : 'No chapters yet.',
                    icon: Icons.track_changes,
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'These chapters have no usable score yet. They are not classified as weak — give one a '
                        'first test to start its baseline.',
                        style: text.bodySmall,
                      ),
                      TextButton.icon(
                        onPressed: () {
                          HapticFeedback.selectionClick();
                          setState(() => _showUntested = !_showUntested);
                        },
                        icon: Icon(_showUntested ? Icons.expand_less : Icons.expand_more, size: 16),
                        label: Text(_showUntested ? 'Hide untested' : 'Show untested (${untested.length})'),
                      ),
                      if (_showUntested) ...<Widget>[
                        for (final String group in <String>{
                          ...subjects,
                          ...untested.map((ChapterPerformance item) => item.chapter.subject),
                        })
                          if (untested.any((ChapterPerformance item) => item.chapter.subject == group))
                            _UntestedGroup(
                              subject: group,
                              chapters: <Chapter>[
                                for (final ChapterPerformance item in untested)
                                  if (item.chapter.subject == group) item.chapter,
                              ],
                              onTap: (Chapter chapter) =>
                                  openTestEditor(context, ref, data, null, presetChapterId: chapter.id),
                            ),
                        Text(
                          'Tap a chapter to log its first test — the test form opens with that chapter already '
                          'selected.',
                          style: text.labelSmall?.copyWith(color: colors.muted),
                        ),
                      ],
                    ],
                  ),
          ),
          const SizedBox(height: 12),
          Text.rich(
            TextSpan(
              children: <InlineSpan>[
                const TextSpan(
                    text: '✳  Weak = below the adjustable threshold. Okay = between thresholds. Strong = above. '),
                const TextSpan(text: 'No usable score means Untested.', style: TextStyle(fontWeight: FontWeight.w700)),
              ],
            ),
            style: text.labelSmall?.copyWith(color: colors.muted),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () => Routes.open(context, Routes.analytics),
              icon: const Icon(Icons.north_east, size: 15),
              label: const Text('See full analytics'),
            ),
          ),
        ],
      ),
    );
  }
}

class _Overview extends StatelessWidget {
  const _Overview({
    required this.icon,
    required this.eyebrow,
    required this.value,
    required this.caption,
    required this.tone,
  });

  final IconData icon;
  final String eyebrow;
  final int value;
  final String caption;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return NotebookCard(
      dense: true,
      accent: tone,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(icon, size: 17, color: tone),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  eyebrow,
                  style: text.labelSmall?.copyWith(letterSpacing: 1.1, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text('$value', style: const TextStyle(fontFamily: 'PatrickHand', fontSize: 30, height: 1.1)),
          Text(caption, style: text.labelSmall?.copyWith(color: context.stracker.muted)),
        ],
      ),
    );
  }
}

class _TestedRow extends StatelessWidget {
  const _TestedRow({required this.item});

  final ChapterPerformance item;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final PillTone tone = switch (item.classification) {
      'Weak' => PillTone.bad,
      'Strong' => PillTone.good,
      _ => PillTone.warn,
    };
    final IconData trendIcon = switch (item.trend) {
      'up' => Icons.trending_up,
      'down' => Icons.trending_down,
      'steady' => Icons.remove,
      _ => Icons.track_changes,
    };
    final Color averageColor = switch (item.classification) {
      'Weak' => colors.palette.red,
      'Strong' => colors.palette.green,
      _ => colors.palette.ink,
    };
    return InkWell(
      onTap: () => Routes.open(context, Routes.syllabus),
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                  width: 4,
                  height: 34,
                  margin: const EdgeInsets.only(right: 8, top: 2),
                  decoration: BoxDecoration(
                    color: colors.subjectColor(item.chapter.subject),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(item.chapter.name, style: text.titleSmall),
                      Text(
                        '${item.chapter.subject} · ${item.results.length} test${item.results.length == 1 ? '' : 's'} used',
                        style: text.labelSmall?.copyWith(color: colors.muted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '${(item.average ?? 0).round()}%',
                  style: TextStyle(fontFamily: 'PatrickHand', fontSize: 22, color: averageColor),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Padding(
              padding: const EdgeInsets.only(left: 12),
              child: Wrap(
                spacing: 6,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: <Widget>[
                  Text(
                    'Last 3: ${item.results.reversed.map((r) => '${r.percentage.round()}%').join(' · ')}',
                    style: text.labelSmall,
                  ),
                  Text('Latest ${(item.latest ?? 0).round()}%', style: text.labelSmall),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Icon(trendIcon, size: 14, color: colors.muted),
                      const SizedBox(width: 2),
                      Text(item.trend == 'none' ? '—' : item.trend, style: text.labelSmall),
                    ],
                  ),
                  if (item.dropping) const Pill('Dropping', tone: PillTone.warn, dense: true),
                  Pill(item.classification, tone: tone, dense: true),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _UntestedGroup extends StatelessWidget {
  const _UntestedGroup({required this.subject, required this.chapters, required this.onTap});

  final String subject;
  final List<Chapter> chapters;
  final ValueChanged<Chapter> onTap;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Wrap(
            spacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              Pill(subject, dense: true),
              Text(
                '${chapters.length} chapter${chapters.length == 1 ? '' : 's'} without a score',
                style: text.labelSmall?.copyWith(color: colors.muted),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: <Widget>[
              for (final Chapter chapter in chapters)
                Semantics(
                  button: true,
                  label: 'Log a test for ${chapter.name} ($subject)',
                  excludeSemantics: true,
                  child: ActionChip(
                    avatar: const Icon(Icons.add, size: 13),
                    label: Text(chapter.name, overflow: TextOverflow.ellipsis),
                    side: BorderSide(color: colors.subjectColor(subject).withValues(alpha: .5)),
                    onPressed: () => onTap(chapter),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.title, this.note, {this.trailing});

  final String title;
  final String note;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 16, 2, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Semantics(header: true, child: Text(title, style: text.titleMedium)),
                Text(note, style: text.labelSmall?.copyWith(color: context.stracker.muted)),
              ],
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}
