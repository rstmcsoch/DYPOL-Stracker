import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/aggregation.dart';
import '../../logic/home_summary.dart';
import '../../logic/progress.dart';
import '../../logic/recommend.dart';
import '../../logic/revision.dart';
import '../focus/focus_indicator.dart';
import '../revision/revision_actions.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// The dashboard: syllabus completion, today's plan, revisions, the study-now
/// recommendation, streaks and the weekly report. Every number is derived from the
/// account's own records.
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final DataState state = ref.watch(dataControllerProvider);
    final AppData data = state.data;
    final String today = todayIso();
    final SyllabusProgress progress = syllabusProgress(data);
    final StudyTotals totals = studyTotals(data, today: today);
    final RevisionBuckets revisions = revisionBuckets(data, today: today);
    final StudyNowResult studyNow = recommendStudyNow(data, today);
    final WeeklyReport report = weeklyReport(data, today: today);
    final List<DailyTask> tasks = data.tasksOn(today);
    final int doneTasks = tasks.where((DailyTask task) => task.isCompleted).length;
    final Map<String, int> stages = stageCounts(data);
    final DateTime now = DateTime.now();
    final StreakSummary streak = computeStreaks(data, today);
    final BigDay bigDay = computeBigDay(data, today);
    final ExamModeState examMode = examModeState(data, today);

    return NotebookScaffold(
      title: 'Stracker',
      showBrand: true,
      body: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          if (state.offline)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: InfoBanner(
                state.error ?? 'Showing your last synced notebook. Connect to the internet to refresh.',
                tone: PillTone.warn,
                icon: Icons.cloud_off_outlined,
              ),
            ),
          _HomeHeader(eyebrow: homeDateEyebrow(now), title: homeGreeting(data, now)),
          const SizedBox(height: 10),
          const FocusIndicator(),
          LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              // The website keeps both cards side by side on phones (1.14fr / 0.8fr); on
              // very narrow screens they stack instead of squeezing the numbers.
              if (constraints.maxWidth < 330) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    _BigDayCard(bigDay: bigDay),
                    const SizedBox(height: 8),
                    _RhythmCard(streak: streak),
                  ],
                );
              }
              return IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Expanded(flex: 114, child: _BigDayCard(bigDay: bigDay)),
                    const SizedBox(width: 7),
                    Expanded(flex: 80, child: _RhythmCard(streak: streak)),
                  ],
                ),
              );
            },
          ),
          if (examMode.active) ...<Widget>[
            const SizedBox(height: 12),
            _ExamModeBanner(state: examMode),
          ],
          const SizedBox(height: 12),
          NotebookCard(
            title: 'Syllabus completion',
            subtitle: 'Raw count and importance-weighted progress, exactly as the website defines them.',
            trailing: TextButton(
              onPressed: () => Routes.open(context, Routes.syllabus),
              child: const Text('Open'),
            ),
            child: Column(
              children: <Widget>[
                Row(
                  children: <Widget>[
                    ProgressRing(value: progress.raw, size: 84),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          _metricLine(context, 'Raw', percentLabel(progress.raw),
                              '${progress.completedChapters} of ${progress.totalChapters} chapters done or revised'),
                          const SizedBox(height: 8),
                          _metricLine(context, 'Weighted', percentLabel(progress.weighted),
                              'Each chapter counts by its own importance'),
                        ],
                      ),
                    ),
                  ],
                ),
                if (progress.bySubject.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 14),
                  for (final SubjectProgress subject in progress.bySubject)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Row(
                            children: <Widget>[
                              Container(
                                width: 8,
                                height: 8,
                                decoration: BoxDecoration(
                                  color: context.stracker.subjectColor(subject.subject),
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 7),
                              Expanded(child: Text(subject.subject, style: Theme.of(context).textTheme.bodySmall)),
                              Text(
                                '${subject.completed}/${subject.total} · ${percentLabel(subject.raw)}',
                                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                      color: context.stracker.muted,
                                    ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          LinearBar(
                            value: (subject.raw ?? 0) / 100,
                            color: context.stracker.subjectColor(subject.subject),
                            height: 6,
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
            title: 'The study cycle',
            subtitle: 'Learn → Test → Analyse → Revise → Repeat, derived from real evidence.',
            child: WrapGrid(
              minItemWidth: 92,
              children: <Widget>[
                for (final String stage in chapterStageKeys)
                  StatTile(
                    value: '${stages[stage] ?? 0}',
                    label: chapterStageLabels[stage] ?? stage,
                    hint: 'chapters',
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Today',
            subtitle: formatDayMonth(today),
            trailing: TextButton(
              onPressed: () => Routes.open(context, Routes.planner),
              child: const Text('Plan'),
            ),
            child: Column(
              children: <Widget>[
                WrapGrid(
                  children: <Widget>[
                    StatTile(
                      value: minutesLabel(totals.todayMinutes),
                      label: 'Studied today',
                      hint: 'goal ${minutesLabel(data.settings.dailyStudyGoalMinutes)}',
                      tone: totals.todayMinutes >= data.settings.dailyStudyGoalMinutes
                          ? context.stracker.palette.green
                          : null,
                    ),
                    StatTile(
                      value: '$doneTasks/${tasks.length}',
                      label: 'Tasks done',
                      hint: tasks.isEmpty ? 'nothing planned' : 'tap to open the plan',
                      onTap: () => Routes.open(context, Routes.planner),
                    ),
                    StatTile(
                      value: '${revisions.overdue.length + revisions.today.length}',
                      label: 'Revisions due',
                      hint: revisions.overdue.isEmpty ? 'on schedule' : '${revisions.overdue.length} overdue',
                      tone: revisions.overdue.isEmpty ? null : context.stracker.palette.red,
                      onTap: () => Routes.open(context, Routes.revision),
                    ),
                  ],
                ),
                if (tasks.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 6),
                  for (final DailyTask task in tasks.take(4))
                    CheckboxListTile(
                      value: task.isCompleted,
                      onChanged: (bool? value) async {
                        try {
                          await ref.read(dataControllerProvider.notifier).saveTask(
                                task.copyWith(isCompleted: value ?? false),
                              );
                        } catch (error) {
                          if (context.mounted) showToast(context, error.toString(), error: true);
                        }
                      },
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      title: Text(
                        task.title,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              decoration: task.isCompleted ? TextDecoration.lineThrough : null,
                            ),
                      ),
                      subtitle: Text(
                        '${task.subject ?? 'General'} · ${minutesLabel(task.estimatedMinutes)} · ${task.priority}',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: context.stracker.muted,
                            ),
                      ),
                    ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 10),
          _StudyNowCard(result: studyNow),
          if (revisions.overdue.isNotEmpty || revisions.today.isNotEmpty) ...<Widget>[
            const SizedBox(height: 10),
            NotebookCard(
              title: 'Revisions waiting',
              trailing: TextButton(
                onPressed: () => Routes.open(context, Routes.revision),
                child: const Text('All'),
              ),
              child: Column(
                children: <Widget>[
                  for (final Revision revision in <Revision>[...revisions.overdue, ...revisions.today].take(3))
                    _RevisionRow(revision: revision, data: data),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          NotebookCard(
            title: 'This week',
            subtitle: 'Only weeks with real data are compared.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                WrapGrid(
                  children: <Widget>[
                    StatTile(value: minutesLabel(totals.weekMinutes), label: 'Study time'),
                    StatTile(value: '${report.thisWeek['Tests'] ?? 0}', label: 'Tests'),
                    StatTile(value: '${report.thisWeek['Revisions'] ?? 0}', label: 'Revisions'),
                    StatTile(value: '${report.thisWeek['Practice questions'] ?? 0}', label: 'Questions'),
                  ],
                ),
                const SizedBox(height: 8),
                for (final String line in report.lines.take(4))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        const Text('·  '),
                        Expanded(
                          child: Text(
                            line,
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                  color: context.stracker.inkSoft,
                                ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Quick links',
            child: Column(
              children: <Widget>[
                _LinkRow(Icons.auto_awesome_outlined, 'Stracker AI', 'Ask about your own data',
                    () => Routes.open(context, 'ai')),
                _LinkRow(Icons.checklist_rtl_outlined, 'Practice / DPP', 'Attempted, correct, accuracy',
                    () => Routes.open(context, Routes.practice)),
                _LinkRow(Icons.local_library_outlined, 'PYQ tracker', 'JEE Main and Advanced by year',
                    () => Routes.open(context, Routes.pyqs)),
                _LinkRow(Icons.warning_amber_outlined, 'Weak areas', 'Below your own threshold',
                    () => Routes.open(context, Routes.weakAreas)),
                _LinkRow(Icons.layers_outlined, 'Formulas & flashcards', 'R1 → R7 → R30 ladder',
                    () => Routes.open(context, Routes.decks)),
                _LinkRow(Icons.backup_outlined, 'Backup & export', 'JSON, CSV, restore',
                    () => Routes.open(context, Routes.backup)),
              ],
            ),
          ),
          if (data.tests.isEmpty && data.practiceSessions.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: InfoBanner(
                'The notebook only reports what you record. Log a test or a practice block and the '
                'analytics fill in.',
                icon: Icons.edit_note,
              ),
            ),
        ],
      ),
    );
  }

  Widget _metricLine(BuildContext context, String label, String value, String hint) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Text(label, style: Theme.of(context).textTheme.labelMedium),
            const Spacer(),
            Text(value, style: Theme.of(context).textTheme.titleMedium),
          ],
        ),
        Text(hint, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: context.stracker.muted)),
      ],
    );
  }
}

class _StudyNowCard extends StatelessWidget {
  const _StudyNowCard({required this.result});

  final StudyNowResult result;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final Recommendation? primary = result.primary;
    return NotebookCard(
      title: 'What should I study now?',
      subtitle: result.examMode
          ? 'Exam mode is on — revision, PYQs and mocks are boosted.'
          : 'Deterministic ranking from your own records, with reasons.',
      trailing: TextButton(
        onPressed: () => Routes.open(context, Routes.studyNow),
        child: const Text('Details'),
      ),
      child: primary == null
          ? Text(
              result.emptyReason ?? 'Nothing to suggest yet.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Pill(primary.kind.replaceAll('-', ' '), tone: PillTone.accent, dense: true),
                    const SizedBox(width: 6),
                    if (primary.subject != null) Pill(primary.subject!, tone: PillTone.neutral, dense: true),
                  ],
                ),
                const SizedBox(height: 7),
                Text(primary.summary, style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 8),
                Row(
                  children: <Widget>[
                    ElevatedButton(
                      onPressed: () => Routes.open(context, primary.route),
                      child: Text(primary.actionLabel),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      onPressed: () => Routes.open(context, Routes.studyNow),
                      child: const Text('Alternatives'),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
}

class _RevisionRow extends ConsumerWidget {
  const _RevisionRow({required this.revision, required this.data});

  final Revision revision;
  final AppData data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Chapter? chapter = data.chapter(revision.chapterId);
    final bool overdue = isPast(revision.dueOn);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(chapter?.name ?? 'Chapter', style: Theme.of(context).textTheme.titleSmall),
                Text(
                  'R${revision.revisionNumber} · ${formatDate(revision.dueOn)} · ${dueLabel(revision.dueOn)}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: overdue ? context.stracker.palette.red : context.stracker.muted,
                      ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () => completeRevision(context, ref, data, revision),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }
}

class _LinkRow extends StatelessWidget {
  const _LinkRow(this.icon, this.title, this.hint, this.onTap);

  final IconData icon;
  final String title;
  final String hint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: Icon(icon, size: 19, color: context.stracker.palette.inkSoft),
      title: Text(title, style: Theme.of(context).textTheme.titleSmall),
      subtitle: Text(hint, style: Theme.of(context).textTheme.labelSmall),
      trailing: const Icon(Icons.chevron_right, size: 18),
      onTap: onTap,
    );
  }
}

/// Website `PageHeader` on Home: the IST date eyebrow, the greeting and the ✦ doodle.
class _HomeHeader extends StatelessWidget {
  const _HomeHeader({required this.eyebrow, required this.title});

  final String eyebrow;
  final String title;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Semantics(
      header: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            eyebrow,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: colors.muted,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.35,
                  fontSize: 13,
                ),
          ),
          const SizedBox(height: 4),
          Text.rich(
            TextSpan(
              children: <InlineSpan>[
                TextSpan(text: title),
                TextSpan(text: '  ✦', style: TextStyle(color: colors.palette.orange, fontSize: 20)),
              ],
            ),
            style: Theme.of(context).textTheme.headlineLarge?.copyWith(fontSize: 29, height: 1.08),
          ),
        ],
      ),
    );
  }
}

/// The website's warm notebook surfaces (`--surface-warm*`, mixed from `--tint-warm`).
class _Warm {
  _Warm(StrackerColors colors)
      : surface = Color.lerp(colors.palette.paper, _tint, .13)!,
        border = Color.lerp(colors.palette.line, _tint, .34)!,
        line = Color.lerp(colors.palette.lineStrong, _tint, .30)!,
        ink = Color.lerp(colors.palette.ink, _tint, .46)!,
        strong = Color.lerp(colors.palette.ink, _tint, .58)!,
        muted = Color.lerp(colors.palette.inkSoft, _tint, .34)!;

  static const Color _tint = Color(0xFFC49A46);
  final Color surface;
  final Color border;
  final Color line;
  final Color ink;
  final Color strong;
  final Color muted;

  BoxDecoration card() => BoxDecoration(
        color: surface,
        border: Border.all(color: border),
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(12),
          topRight: Radius.circular(14),
          bottomRight: Radius.circular(12),
          bottomLeft: Radius.circular(13),
        ),
      );
}

class _BigDayCard extends StatelessWidget {
  const _BigDayCard({required this.bigDay});

  final BigDay bigDay;

  Future<void> _openSettings(BuildContext context) async {
    await HapticFeedback.selectionClick();
    if (context.mounted) await Routes.open(context, Routes.settings);
  }

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final _Warm warm = _Warm(colors);
    final TextTheme text = Theme.of(context).textTheme;
    final BigDayExam? primary = bigDay.primary;
    final BigDayExam? secondary = bigDay.secondary;

    Widget mini({required bool orange, required String label, required Widget value}) => Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Row(
            children: <Widget>[
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  color: orange ? colors.palette.maths : colors.palette.physics,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 5),
              Flexible(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.labelSmall?.copyWith(color: colors.muted, fontSize: 12.5)),
              ),
              const SizedBox(width: 5),
              value,
            ],
          ),
        );

    return Semantics(
      container: true,
      label: 'The big day',
      child: Container(
        decoration: warm.card(),
        padding: const EdgeInsets.fromLTRB(12, 12, 11, 10),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    Text('THE BIG DAY',
                        style: text.labelSmall?.copyWith(
                            color: warm.muted, fontWeight: FontWeight.w700, letterSpacing: 1.2, fontSize: 12.5)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                      decoration: BoxDecoration(
                        color: colors.palette.paper.withValues(alpha: .55),
                        border: Border.all(color: warm.line),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Icon(Icons.rocket_launch_outlined, size: 12, color: warm.ink),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(bigDay.badge,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: text.labelSmall?.copyWith(color: warm.ink, fontSize: 12.5)),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (primary == null)
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(bigDay.unsetLabel, style: text.labelSmall?.copyWith(color: colors.muted, fontSize: 13)),
                      Text.rich(
                        TextSpan(
                          children: <InlineSpan>[
                            const TextSpan(text: 'Set your date\n'),
                            TextSpan(text: 'when you’re ready.', style: TextStyle(color: colors.muted)),
                          ],
                        ),
                        style: text.headlineSmall?.copyWith(fontSize: 22, height: 1.02),
                      ),
                      const SizedBox(height: 3),
                      Text('We’ll keep the countdown honest.',
                          style: text.labelSmall?.copyWith(color: colors.muted, fontSize: 13)),
                      const SizedBox(height: 6),
                      OutlinedButton(
                        onPressed: () => _openSettings(context),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 34),
                          padding: const EdgeInsets.symmetric(horizontal: 10),
                          visualDensity: VisualDensity.compact,
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            Text('Add exam date'),
                            SizedBox(width: 4),
                            Icon(Icons.arrow_forward, size: 15)
                          ],
                        ),
                      ),
                    ],
                  )
                else
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: <Widget>[
                      Text.rich(
                        TextSpan(
                          children: <InlineSpan>[
                            TextSpan(text: '${primary.days! < 0 ? 0 : primary.days}'),
                            TextSpan(text: ' days', style: text.labelMedium?.copyWith(fontSize: 13, color: colors.ink)),
                          ],
                        ),
                        style: text.headlineLarge?.copyWith(
                          fontSize: 44,
                          height: 1,
                          letterSpacing: -1.5,
                          fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.only(left: 8),
                          decoration: BoxDecoration(border: Border(left: BorderSide(color: warm.line))),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text('until', style: text.labelSmall?.copyWith(color: colors.inkSoft, fontSize: 12.5)),
                              Text(primary.label,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: text.titleMedium
                                      ?.copyWith(fontFamily: 'PatrickHand', fontSize: 16, height: 1.05)),
                              Text(prettyDate(primary.date),
                                  style: text.labelSmall?.copyWith(color: colors.muted, fontSize: 12.5)),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.only(top: 6),
              decoration: BoxDecoration(border: Border(top: BorderSide(color: warm.line))),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (secondary != null)
                    mini(
                      orange: secondary.dotOrange,
                      label: secondary.label,
                      value: secondary.days == null
                          ? InkWell(
                              borderRadius: BorderRadius.circular(6),
                              onTap: () => _openSettings(context),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                                child: Text('Add date',
                                    style: text.labelSmall?.copyWith(color: colors.accent, fontSize: 12.5)),
                              ),
                            )
                          : Text('${secondary.days! < 0 ? 0 : secondary.days} days',
                              style: text.labelSmall
                                  ?.copyWith(color: colors.inkSoft, fontWeight: FontWeight.w700, fontSize: 12.5)),
                    ),
                  mini(
                    orange: true,
                    label: 'Chapters covered',
                    value: Text('${bigDay.completedChapters}/${bigDay.totalChapters}',
                        style: text.labelSmall
                            ?.copyWith(color: colors.inkSoft, fontWeight: FontWeight.w700, fontSize: 12.5)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RhythmCard extends StatelessWidget {
  const _RhythmCard({required this.streak});

  final StreakSummary streak;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final _Warm warm = _Warm(colors);
    final TextTheme text = Theme.of(context).textTheme;
    final TextStyle? small = text.labelSmall?.copyWith(color: warm.muted, fontSize: 12.5);
    final TextStyle? strong = text.titleSmall?.copyWith(
      fontFamily: 'PatrickHand',
      fontSize: 15,
      color: warm.strong,
      fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
    );
    return Semantics(
      container: true,
      label: 'Your rhythm',
      child: Container(
        decoration: warm.card(),
        padding: const EdgeInsets.fromLTRB(10, 12, 9, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  width: 26,
                  height: 26,
                  decoration: BoxDecoration(
                    color: colors.palette.orangeBg,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.local_fire_department_outlined, size: 16, color: colors.palette.orange),
                ),
                const SizedBox(width: 5),
                Flexible(
                  child: Text('YOUR RHYTHM ✦',
                      style: text.labelSmall?.copyWith(
                          color: colors.muted, fontWeight: FontWeight.w700, letterSpacing: .7, fontSize: 12)),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Text.rich(
              TextSpan(
                children: <InlineSpan>[
                  TextSpan(text: '${streak.current}'),
                  TextSpan(text: ' day${streak.current == 1 ? '' : 's'}', style: const TextStyle(fontSize: 18)),
                ],
              ),
              style: text.headlineLarge?.copyWith(
                fontSize: 42,
                height: 1,
                fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(height: 4),
            Text('current study streak', style: small?.copyWith(fontWeight: FontWeight.w500)),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.only(top: 8),
              decoration: BoxDecoration(border: Border(top: BorderSide(color: warm.line))),
              child: Wrap(
                spacing: 7,
                runSpacing: 2,
                children: <Widget>[
                  Text.rich(
                      TextSpan(children: <InlineSpan>[
                        TextSpan(text: '${streak.longest}', style: strong),
                        const TextSpan(text: ' longest'),
                      ]),
                      style: small),
                  Text.rich(
                      TextSpan(children: <InlineSpan>[
                        TextSpan(text: '${streak.weeklyConsistency}/7', style: strong),
                        const TextSpan(text: ' active this week'),
                      ]),
                      style: small),
                ],
              ),
            ),
            const SizedBox(height: 6),
            Text(
              streak.qualifyingToday
                  ? 'Today counts.'
                  : 'A day counts after 15+ min of study, a practice log, a completed revision, or a test.',
              style: text.labelSmall?.copyWith(color: colors.muted, fontSize: 12, height: 1.3),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExamModeBanner extends StatelessWidget {
  const _ExamModeBanner({required this.state});

  final ExamModeState state;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: colors.palette.orangeBg,
          border: Border.all(color: colors.palette.orange),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          children: <Widget>[
            Container(
              width: 58,
              height: 58,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: colors.palette.paper, shape: BoxShape.circle),
              child: Text(state.daysLeft == null ? '' : '${state.daysLeft}',
                  style: text.headlineMedium?.copyWith(color: colors.palette.orange, fontSize: 22)),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Exam Mode · ${state.label}',
                      style: text.titleSmall?.copyWith(fontWeight: FontWeight.w700, color: colors.ink)),
                  const SizedBox(height: 2),
                  Text('${state.reason} Revision, PYQs, mocks and weak-area fixes come first.',
                      style: text.bodySmall?.copyWith(color: colors.inkSoft, fontSize: 13)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
