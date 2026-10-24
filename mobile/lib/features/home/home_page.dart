import 'package:flutter/material.dart';
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
import '../../logic/exam.dart';
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
    final String name = data.profile?.displayName.isNotEmpty == true
        ? data.profile!.displayName
        : (data.settings.ownerName.isEmpty ? 'there' : data.settings.ownerName);
    final String examTitle = chosenExamTitle(data);
    final String track = effectiveTrack(data.settings);
    final String? examDate = trackDate(data, track);
    final bool examMode = currentExamMode(data, today);

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
                state.error ??
                    'Showing your last synced notebook. Connect to the internet to refresh.',
                tone: PillTone.warn,
                icon: Icons.cloud_off_outlined,
              ),
            ),
          const FocusIndicator(),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'Hi, $name',
                      style: Theme.of(context).textTheme.headlineLarge,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${trackLabels(data)[track] ?? examTitle} · ${countdownLabel(examDate)}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: context.stracker.muted,
                          ),
                    ),
                  ],
                ),
              ),
              Pill(
                examMode ? 'Exam mode' : '${totals.streak} day streak',
                tone: examMode ? PillTone.bad : PillTone.accent,
                icon: examMode ? Icons.bolt : Icons.local_fire_department_outlined,
              ),
            ],
          ),
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
                    StatTile(
                      value: '${totals.streak}',
                      label: 'Day streak',
                      hint: '15+ min or a logged record',
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
                    if (primary.subject != null)
                      Pill(primary.subject!, tone: PillTone.neutral, dense: true),
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
