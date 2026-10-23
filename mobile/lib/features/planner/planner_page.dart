import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
import '../../logic/aggregation.dart';
import '../shell/app_shell.dart';

/// Study plan: today's task list, the rest of the week, and weekly goals. Tasks and
/// goals are the same rows the website's planner writes.
class PlannerPage extends ConsumerStatefulWidget {
  const PlannerPage({super.key});

  @override
  ConsumerState<PlannerPage> createState() => _PlannerPageState();
}

class _PlannerPageState extends ConsumerState<PlannerPage> {
  String _date = todayIso();

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final List<DailyTask> tasks = data.tasksOn(_date)
      ..sort((DailyTask a, DailyTask b) => a.position.compareTo(b.position));
    final int planned = tasks.fold<int>(0, (int sum, DailyTask task) => sum + task.estimatedMinutes);
    final int done = tasks.where((DailyTask task) => task.isCompleted).length;
    final String weekStart = startOfWeek(_date);
    final List<WeeklyGoal> goals =
        data.goals.where((WeeklyGoal goal) => goal.weekStart == weekStart).toList();
    final StudyTotals totals = studyTotals(data);

    return SectionPage(
      title: 'Study plan',
      subtitle: '${tasks.length} tasks · ${minutesLabel(planned)} planned · $done done',
      actions: <Widget>[
        IconButton(
          tooltip: 'Pick a day',
          icon: const Icon(Icons.event, size: 20),
          onPressed: () async {
            final DateTime? picked = await showDatePicker(
              context: context,
              initialDate: parseIsoOrToday(_date),
              firstDate: DateTime(2020),
              lastDate: DateTime(2100),
            );
            if (picked != null) setState(() => _date = isoDate(picked));
          },
        ),
      ],
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => openTaskEditor(context, ref, data, null, _date),
        backgroundColor: colors.palette.accentDark,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add, size: 19),
        label: const Text('Add task'),
      ),
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          Row(
            children: <Widget>[
              IconButton(
                icon: const Icon(Icons.chevron_left),
                onPressed: () => setState(() => _date = addDays(_date, -1)),
              ),
              Expanded(
                child: InkWell(
                  onTap: () => setState(() => _date = todayIso()),
                  child: Column(
                    children: <Widget>[
                      Text(
                        _date == todayIso() ? 'Today' : formatDate(_date),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      Text(
                        '${planned == 0 ? 'nothing planned' : minutesLabel(planned)} · goal '
                        '${minutesLabel(data.settings.dailyStudyGoalMinutes)}',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                      ),
                    ],
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right),
                onPressed: () => setState(() => _date = addDays(_date, 1)),
              ),
            ],
          ),
          LinearBar(
            value: planned == 0 ? 0 : (planned / data.settings.dailyStudyGoalMinutes).clamp(0, 1).toDouble(),
            height: 7,
          ),
          const SizedBox(height: 12),
          if (tasks.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: 'Nothing planned for this day',
                message: 'Plan in minutes you can actually keep: a chapter, a revision and a practice '
                    'block is a full day.',
                icon: Icons.event_note_outlined,
                action: ElevatedButton(
                  onPressed: () => openTaskEditor(context, ref, data, null, _date),
                  child: const Text('Plan a task'),
                ),
              ),
            )
          else
            for (final DailyTask task in tasks) _TaskTile(task: task, data: data),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Week of ${formatDate(weekStart)}',
            trailing: TextButton(
              onPressed: () => openGoalEditor(context, ref, data, null, weekStart),
              child: const Text('Add goal'),
            ),
            subtitle: '${minutesLabel(totals.weekMinutes)} studied this week',
            child: goals.isEmpty
                ? Text(
                    'No weekly goals yet. A goal is a number you can hit — chapters, questions, tests or '
                    'minutes.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                  )
                : Column(
                    children: <Widget>[
                      for (final WeeklyGoal goal in goals)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Row(
                                children: <Widget>[
                                  Expanded(
                                    child: Text(goal.title, style: Theme.of(context).textTheme.titleSmall),
                                  ),
                                  Text(
                                    '${numberLabel(goal.progressValue, digits: 1)} / '
                                    '${numberLabel(goal.target, digits: 0)} ${goal.unit}',
                                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                          color: colors.muted,
                                        ),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.delete_outline, size: 17),
                                    tooltip: 'Delete goal',
                                    onPressed: () async {
                                      final bool confirmed = await confirmAction(
                                        context,
                                        title: 'Delete this goal?',
                                        message: 'Progress recorded against it goes too.',
                                      );
                                      if (!confirmed) return;
                                      try {
                                        await ref
                                            .read(dataControllerProvider.notifier)
                                            .deleteGoal(goal);
                                        if (context.mounted) showToast(context, 'Goal deleted.');
                                      } catch (error) {
                                        if (context.mounted) {
                                          showToast(context, error.toString(), error: true);
                                        }
                                      }
                                    },
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              LinearBar(value: goal.progress, height: 6),
                              const SizedBox(height: 4),
                              Row(
                                children: <Widget>[
                                  TextButton(
                                    onPressed: () => openGoalEditor(context, ref, data, goal, weekStart),
                                    child: const Text('Update'),
                                  ),
                                  Text(
                                    goal.goalType,
                                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                          color: colors.muted,
                                        ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => _copyYesterday(context, ref, data),
            icon: const Icon(Icons.content_copy, size: 17),
            label: const Text('Copy yesterday’s plan to this day'),
          ),
        ],
      ),
    );
  }

  Future<void> _copyYesterday(BuildContext context, WidgetRef ref, AppData data) async {
    final List<DailyTask> source = data.tasksOn(addDays(_date, -1));
    if (source.isEmpty) {
      showToast(context, 'Yesterday has no tasks to copy.');
      return;
    }
    final bool confirmed = await confirmAction(
      context,
      title: 'Copy ${source.length} tasks?',
      message: 'They are added to ${formatDate(_date)} as new, unchecked tasks.',
      confirmLabel: 'Copy',
    );
    if (!confirmed) return;
    try {
      final int start = data.tasksOn(_date).length;
      for (int i = 0; i < source.length; i += 1) {
        final DailyTask task = source[i];
        await ref.read(dataControllerProvider.notifier).saveTask(
              DailyTask(
                id: newId(),
                userId: data.userId,
                title: task.title,
                subject: task.subject,
                chapterId: task.chapterId,
                estimatedMinutes: task.estimatedMinutes,
                priority: task.priority,
                taskDate: _date,
                position: start + i,
                createdAt: isoNow(),
                updatedAt: isoNow(),
              ),
            );
      }
      if (context.mounted) showToast(context, '${source.length} tasks copied.');
    } catch (error) {
      if (context.mounted) showToast(context, error.toString(), error: true);
    }
  }
}

class _TaskTile extends ConsumerWidget {
  const _TaskTile({required this.task, required this.data});

  final DailyTask task;
  final AppData data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: NotebookCard(
        dense: true,
        padding: const EdgeInsets.fromLTRB(6, 4, 6, 4),
        child: Row(
          children: <Widget>[
            Checkbox(
              value: task.isCompleted,
              onChanged: (bool? value) async {
                try {
                  await ref
                      .read(dataControllerProvider.notifier)
                      .saveTask(task.copyWith(isCompleted: value ?? false));
                } catch (error) {
                  if (context.mounted) showToast(context, error.toString(), error: true);
                }
              },
            ),
            Expanded(
              child: InkWell(
                onTap: () => openTaskEditor(context, ref, data, task, task.taskDate),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        task.title,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              decoration: task.isCompleted ? TextDecoration.lineThrough : null,
                            ),
                      ),
                      Text(
                        <String>[
                          if (task.subject != null) task.subject!,
                          minutesLabel(task.estimatedMinutes),
                          '${task.priority} priority',
                          if (task.chapterId != null) data.chapterName(task.chapterId),
                        ].join(' · '),
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 17),
              tooltip: 'Delete task',
              onPressed: () async {
                final bool confirmed = await confirmAction(
                  context,
                  title: 'Delete this task?',
                  message: 'It disappears from the website’s planner too.',
                );
                if (!confirmed) return;
                try {
                  await ref.read(dataControllerProvider.notifier).deleteTask(task);
                  if (context.mounted) showToast(context, 'Task deleted.');
                } catch (error) {
                  if (context.mounted) showToast(context, error.toString(), error: true);
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> openTaskEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  DailyTask? task,
  String date,
) async {
  final bool creating = task == null;
  final TextEditingController title = TextEditingController(text: task?.title ?? '');
  final TextEditingController minutes =
      TextEditingController(text: task?.estimatedMinutes.toString() ?? '30');
  String priority = task?.priority ?? 'Medium';
  String? subject = task?.subject;
  String? chapterId = task?.chapterId;
  String taskDate = task?.taskDate ?? date;
  String? titleError;
  String? minutesError;

  await showAppSheet<void>(
    context,
    title: creating ? 'Plan a task' : 'Edit task',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppField(
            label: 'Task',
            controller: title,
            required: true,
            maxLength: 160,
            error: titleError,
            hint: 'e.g. Rotational motion — 20 PYQs',
          ),
          AppDateField(
            label: 'Day',
            value: taskDate,
            onChanged: (String? value) {
              if (value != null) setSheetState(() => taskDate = value);
            },
          ),
          AppSelect<String?>(
            label: 'Subject (optional)',
            value: subject,
            items: <String?>[null, ...data.subjects],
            labelFor: (String? value) => value ?? 'No subject',
            onChanged: (String? value) => setSheetState(() => subject = value),
          ),
          AppSelect<String?>(
            label: 'Chapter (optional)',
            value: chapterId,
            items: <String?>[null, ...data.chapters.map((Chapter chapter) => chapter.id)],
            labelFor: (String? value) => value == null ? 'No chapter' : data.chapterName(value),
            onChanged: (String? value) => setSheetState(() => chapterId = value),
          ),
          Row(
            children: <Widget>[
              Expanded(
                child: AppField(
                  label: 'Minutes',
                  controller: minutes,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                  error: minutesError,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppSelect<String>(
                  label: 'Priority',
                  value: priority,
                  items: const <String>['High', 'Medium', 'Low'],
                  onChanged: (String? value) => setSheetState(() => priority = value ?? priority),
                ),
              ),
            ],
          ),
          ElevatedButton(
            onPressed: () async {
              final String? minutesProblem = Validators.minutes(minutes.text, max: 1440, label: 'Minutes');
              setSheetState(() {
                titleError = title.text.trim().isEmpty ? 'Give the task a name.' : null;
                minutesError = minutesProblem;
              });
              if (titleError != null || minutesProblem != null) return;
              final DailyTask next = DailyTask(
                id: task?.id ?? newId(),
                userId: data.userId,
                title: title.text.trim(),
                subject: subject,
                chapterId: chapterId,
                estimatedMinutes: int.tryParse(minutes.text.trim()) ?? 30,
                priority: priority,
                isCompleted: task?.isCompleted ?? false,
                taskDate: taskDate,
                position: task?.position ?? data.tasksOn(taskDate).length,
                createdAt: task?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref.read(dataControllerProvider.notifier).saveTask(next);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, creating ? 'Task added.' : 'Task saved.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: Text(creating ? 'Add task' : 'Save'),
          ),
        ],
      ),
    ),
  );
  title.dispose();
  minutes.dispose();
}

Future<void> openGoalEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  WeeklyGoal? goal,
  String weekStart,
) async {
  final bool creating = goal == null;
  final TextEditingController title = TextEditingController(text: goal?.title ?? '');
  final TextEditingController target =
      TextEditingController(text: goal == null ? '' : numberLabel(goal.target, digits: 0));
  final TextEditingController progress = TextEditingController(
    text: goal == null ? '0' : numberLabel(goal.progressValue, digits: 1),
  );
  final TextEditingController unit = TextEditingController(text: goal?.unit ?? 'chapters');
  String goalType = goal?.goalType ?? 'chapters';

  await showAppSheet<void>(
    context,
    title: creating ? 'Weekly goal' : 'Update goal',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppField(label: 'Goal', controller: title, required: true, maxLength: 160),
          AppSelect<String>(
            label: 'Type',
            value: goalType,
            items: const <String>['chapters', 'questions', 'tests', 'minutes', 'custom'],
            onChanged: (String? value) => setSheetState(() => goalType = value ?? goalType),
          ),
          Row(
            children: <Widget>[
              Expanded(
                child: AppField(
                  label: 'Target',
                  controller: target,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppField(
                  label: 'Progress',
                  controller: progress,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                ),
              ),
            ],
          ),
          AppField(label: 'Unit', controller: unit, maxLength: 20),
          ElevatedButton(
            onPressed: () async {
              final double targetValue = double.tryParse(target.text.trim()) ?? 0;
              if (title.text.trim().isEmpty || targetValue <= 0) {
                showToast(context, 'A goal needs a name and a positive target.', error: true);
                return;
              }
              final WeeklyGoal next = WeeklyGoal(
                id: goal?.id ?? newId(),
                userId: data.userId,
                goalType: goalType,
                title: title.text.trim(),
                target: targetValue,
                progressValue: double.tryParse(progress.text.trim()) ?? 0,
                weekStart: goal?.weekStart ?? weekStart,
                unit: unit.text.trim(),
                createdAt: goal?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref.read(dataControllerProvider.notifier).saveGoal(next);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, creating ? 'Goal added.' : 'Goal updated.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: Text(creating ? 'Add goal' : 'Save'),
          ),
        ],
      ),
    ),
  );
  title.dispose();
  target.dispose();
  progress.dispose();
  unit.dispose();
}
