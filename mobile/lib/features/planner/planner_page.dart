import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/home_summary.dart' show prettyDate;
import '../../logic/planner.dart';
import '../../logic/search.dart';
import '../search/search_focus.dart';
import '../shell/app_shell.dart';

/// Planner, as src/pages/PlannerPage.tsx: a Monday-first week strip, the selected day's
/// tasks (complete, reorder, duplicate, edit, delete) and weekly goals whose progress comes
/// from real activity. Tasks and goals are the same rows the website writes.
class PlannerPage extends ConsumerStatefulWidget {
  const PlannerPage({super.key});

  @override
  ConsumerState<PlannerPage> createState() => _PlannerPageState();
}

class _PlannerPageState extends ConsumerState<PlannerPage> {
  String _weekStart = startOfWeek(todayIso());
  String _selected = todayIso();

  @override
  void initState() {
    super.initState();
    // Opened from a search result: show the week and day that hold the task.
    final SearchFocus? focus = SearchFocusScope.of(context);
    if (focus != null && focus.kind == SearchKind.task) {
      final DailyTask? task =
          ref.read(dataControllerProvider).data.tasks.where((DailyTask t) => t.id == focus.id).firstOrNull;
      if (task != null) {
        _selected = task.taskDate;
        _weekStart = startOfWeek(task.taskDate);
      }
    }
  }

  void _selectWeek(String start) => setState(() {
        _weekStart = start;
        _selected = start;
      });

  Future<void> _copyPreviousDay(BuildContext context, AppData data) async {
    final List<DailyTask> source = data.tasksOn(addDays(_selected, -1));
    if (source.isEmpty) {
      showToast(context, 'The previous day has no tasks to copy.');
      return;
    }
    final bool confirmed = await confirmAction(
      context,
      title: 'Copy ${source.length} tasks?',
      message: 'They are added to ${formatDate(_selected)} as new, unchecked tasks.',
      confirmLabel: 'Copy',
    );
    if (!confirmed) return;
    try {
      final int start = data.tasksOn(_selected).length;
      for (int i = 0; i < source.length; i += 1) {
        final DailyTask task = source[i];
        await ref.read(dataControllerProvider.notifier).saveTask(DailyTask(
              id: newId(),
              userId: data.userId,
              title: task.title,
              subject: task.subject,
              chapterId: task.chapterId,
              topic: task.topic,
              estimatedMinutes: task.estimatedMinutes,
              priority: task.priority,
              taskDate: _selected,
              position: start + i,
              createdAt: isoNow(),
              updatedAt: isoNow(),
            ));
      }
      if (context.mounted) showToast(context, 'Copied ${source.length} tasks.');
    } catch (error) {
      if (context.mounted) showToast(context, 'Could not copy tasks.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final String today = todayIso();
    final List<String> days = <String>[for (int i = 0; i < 7; i += 1) addDays(_weekStart, i)];
    final List<DailyTask> tasks = data.tasksOn(_selected);
    final int done = tasks.where((DailyTask task) => task.isCompleted).length;
    final int doneMinutes =
        tasks.where((DailyTask t) => t.isCompleted).fold<int>(0, (int sum, DailyTask t) => sum + t.estimatedMinutes);
    final List<WeeklyGoal> goals = data.goals.where((WeeklyGoal goal) => goal.weekStart == _weekStart).toList();
    final DateTime selectedDay = parseIsoOrToday(_selected);

    return SectionPage(
      title: 'Planner',
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'planner-add',
        onPressed: () => openTaskEditor(context, ref, data, null, _selected),
        backgroundColor: colors.palette.accentDark,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add, size: 19),
        label: const Text('Add task'),
      ),
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text('This week, on paper',
                              style: text.titleMedium?.copyWith(fontFamily: 'PatrickHand', fontSize: 19)),
                          Text(
                            '${_dayMonth(_weekStart)} – ${_dayMonthYear(addDays(_weekStart, 6))}',
                            style: text.labelSmall?.copyWith(color: colors.muted),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Previous week',
                      icon: const Icon(Icons.arrow_back, size: 18),
                      onPressed: () => _selectWeek(addDays(_weekStart, -7)),
                    ),
                    TextButton(
                      onPressed: () => _selectWeek(startOfWeek(today)),
                      child: const Text('This week'),
                    ),
                    IconButton(
                      tooltip: 'Next week',
                      icon: const Icon(Icons.arrow_forward, size: 18),
                      onPressed: () => _selectWeek(addDays(_weekStart, 7)),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: <Widget>[
                    for (final String day in days)
                      Expanded(
                          child: _DayButton(
                              day: day,
                              selected: day == _selected,
                              today: day == today,
                              data: data,
                              onTap: () {
                                HapticFeedback.selectionClick();
                                setState(() => _selected = day);
                              })),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            _selected == today ? 'TODAY' : weekdayLong[selectedDay.weekday - 1].toUpperCase(),
                            style: text.labelSmall?.copyWith(color: colors.muted, letterSpacing: 1.2),
                          ),
                          Text('${selectedDay.day} ${_monthLong(selectedDay.month)}', style: text.headlineSmall),
                        ],
                      ),
                    ),
                    Text('$done / ${tasks.length} complete', style: text.labelSmall?.copyWith(color: colors.muted)),
                  ],
                ),
                const SizedBox(height: 8),
                if (tasks.isEmpty)
                  EmptyState(
                    title: 'Nothing planned for this day.',
                    icon: Icons.calendar_today_outlined,
                    action: OutlinedButton.icon(
                      onPressed: () => openTaskEditor(context, ref, data, null, _selected),
                      icon: const Icon(Icons.add, size: 16),
                      label: const Text('Plan a task'),
                    ),
                  )
                else
                  for (int i = 0; i < tasks.length; i += 1)
                    SearchTarget(
                      id: tasks[i].id,
                      radius: 12,
                      child: _TaskRow(task: tasks[i], index: i, tasks: tasks, data: data),
                    ),
                Divider(color: colors.palette.line),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text('Use the arrows to reorder. Edit a task to move dates.',
                          style: text.labelSmall?.copyWith(color: colors.muted)),
                    ),
                    Text('${fmtDuration(doneMinutes)} complete', style: text.labelSmall?.copyWith(color: colors.muted)),
                  ],
                ),
                const SizedBox(height: 6),
                OutlinedButton.icon(
                  onPressed: () => _copyPreviousDay(context, data),
                  icon: const Icon(Icons.content_copy, size: 17),
                  label: const Text('Copy the previous day’s plan here'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text('WEEKLY GOALS',
                              style: text.labelSmall
                                  ?.copyWith(color: colors.muted, fontWeight: FontWeight.w700, letterSpacing: 1.1)),
                          Text('Little promises', style: text.headlineSmall),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Add weekly goal',
                      icon: const Icon(Icons.add, size: 19),
                      onPressed: () => openGoalEditor(context, ref, data, _weekStart),
                    ),
                  ],
                ),
                if (goals.isEmpty)
                  EmptyState(
                    title: 'No goals set for this week.',
                    message: 'Choose a target that feels useful, not punishing.',
                    icon: Icons.flag_outlined,
                    action: OutlinedButton.icon(
                      onPressed: () => openGoalEditor(context, ref, data, _weekStart),
                      icon: const Icon(Icons.add, size: 16),
                      label: const Text('Add a goal'),
                    ),
                  )
                else
                  for (final WeeklyGoal goal in goals) _GoalRow(goal: goal, data: data),
              ],
            ),
          ),
          const SizedBox(height: 12),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('A NOTE TO SELF', style: text.labelSmall?.copyWith(color: colors.muted, letterSpacing: 1.2)),
                const SizedBox(height: 4),
                Text('Plans are drafts. Move the task, keep the intention.', style: text.bodyMedium),
                Align(
                  alignment: Alignment.centerRight,
                  child: Text('keep going ♡',
                      style: TextStyle(fontFamily: 'PatrickHand', fontSize: 16, color: colors.palette.accent)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

const List<String> _monthsLong = <String>[
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

String _monthLong(int month) => _monthsLong[month - 1];

String _dayMonth(String iso) {
  final DateTime d = parseIsoOrToday(iso);
  return '${d.day} ${_monthLong(d.month).substring(0, 3) == 'Sep' ? 'Sept' : _monthLong(d.month).substring(0, 3)}';
}

String _dayMonthYear(String iso) => '${_dayMonth(iso)} ${parseIsoOrToday(iso).year}';

class _DayButton extends StatelessWidget {
  const _DayButton(
      {required this.day, required this.selected, required this.today, required this.data, required this.onTap});

  final String day;
  final bool selected;
  final bool today;
  final AppData data;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final DateTime date = parseIsoOrToday(day);
    final List<DailyTask> dayTasks = data.tasksOn(day);
    final bool complete = dayTasks.isNotEmpty && dayTasks.every((DailyTask t) => t.isCompleted);
    return Semantics(
      selected: selected,
      button: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: Material(
          color: selected ? colors.palette.accentLight : Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: BorderSide(color: today ? colors.palette.accent : colors.palette.line),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 58),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Text(weekdayShort[date.weekday - 1], style: TextStyle(fontSize: 11, color: colors.muted)),
                  Text('${date.day}',
                      style: TextStyle(
                          fontFamily: 'PatrickHand',
                          fontSize: 19,
                          color: selected ? colors.palette.textAccent : colors.palette.ink)),
                  SizedBox(
                    height: 6,
                    child: dayTasks.isEmpty
                        ? null
                        : Container(
                            width: 5,
                            height: 5,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: complete ? colors.palette.green : colors.palette.orange,
                            ),
                          ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TaskRow extends ConsumerWidget {
  const _TaskRow({required this.task, required this.index, required this.tasks, required this.data});

  final DailyTask task;
  final int index;
  final List<DailyTask> tasks;
  final AppData data;

  Future<void> _move(BuildContext context, WidgetRef ref, int direction) async {
    final int to = index + direction;
    if (to < 0 || to >= tasks.length) return;
    await HapticFeedback.selectionClick();
    final List<DailyTask> reordered = <DailyTask>[...tasks];
    final DailyTask moved = reordered.removeAt(index);
    reordered.insert(to, moved);
    try {
      for (int position = 0; position < reordered.length; position += 1) {
        if (reordered[position].position != position) {
          await ref.read(dataControllerProvider.notifier).saveTask(reordered[position].copyWith(position: position));
        }
      }
    } catch (error) {
      if (context.mounted) showToast(context, 'Could not reorder tasks.', error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final String? chapter = task.chapterId == null ? null : data.chapterName(task.chapterId);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Checkbox(
            value: task.isCompleted,
            semanticLabel: task.isCompleted ? 'Mark ${task.title} incomplete' : 'Complete ${task.title}',
            onChanged: (bool? value) async {
              await HapticFeedback.lightImpact();
              try {
                await ref.read(dataControllerProvider.notifier).saveTask(task.copyWith(isCompleted: value ?? false));
              } catch (error) {
                if (context.mounted) showToast(context, 'Could not update task.', error: true);
              }
            },
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    task.title,
                    style: text.bodyMedium?.copyWith(
                      decoration: task.isCompleted ? TextDecoration.lineThrough : null,
                      color: task.isCompleted ? colors.muted : null,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    <String>[
                      if (task.subject != null) task.subject!,
                      if (chapter != null && chapter.isNotEmpty) chapter,
                      if ((task.topic ?? '').isNotEmpty) task.topic!,
                      fmtDuration(task.estimatedMinutes),
                      task.priority,
                    ].join(' · '),
                    style: text.labelSmall?.copyWith(color: colors.muted),
                  ),
                ],
              ),
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Task actions',
            icon: const Icon(Icons.more_vert, size: 19),
            onSelected: (String action) async {
              switch (action) {
                case 'up':
                  await _move(context, ref, -1);
                case 'down':
                  await _move(context, ref, 1);
                case 'duplicate':
                  try {
                    await ref.read(dataControllerProvider.notifier).saveTask(DailyTask(
                          id: newId(),
                          userId: data.userId,
                          title: '${task.title} (copy)'.length > 200
                              ? '${task.title} (copy)'.substring(0, 200)
                              : '${task.title} (copy)',
                          subject: task.subject,
                          chapterId: task.chapterId,
                          topic: task.topic,
                          estimatedMinutes: task.estimatedMinutes,
                          priority: task.priority,
                          taskDate: task.taskDate,
                          position: tasks.length,
                          createdAt: isoNow(),
                          updatedAt: isoNow(),
                        ));
                    if (context.mounted) showToast(context, 'Task duplicated.');
                  } catch (error) {
                    if (context.mounted) showToast(context, 'Could not duplicate task.', error: true);
                  }
                case 'edit':
                  await openTaskEditor(context, ref, data, task, task.taskDate);
                case 'delete':
                  final bool confirmed = await confirmAction(
                    context,
                    title: 'Delete “${task.title}”?',
                    message: 'This task will be removed from your plan.',
                  );
                  if (!confirmed) return;
                  try {
                    await ref.read(dataControllerProvider.notifier).deleteTask(task);
                    if (context.mounted) showToast(context, 'Task deleted.');
                  } catch (error) {
                    if (context.mounted) showToast(context, 'Could not delete task.', error: true);
                  }
              }
            },
            itemBuilder: (BuildContext context) => <PopupMenuEntry<String>>[
              PopupMenuItem<String>(value: 'up', enabled: index > 0, child: const Text('Move up')),
              PopupMenuItem<String>(value: 'down', enabled: index < tasks.length - 1, child: const Text('Move down')),
              const PopupMenuItem<String>(value: 'duplicate', child: Text('Duplicate')),
              const PopupMenuItem<String>(value: 'edit', child: Text('Edit or reschedule')),
              const PopupMenuItem<String>(value: 'delete', child: Text('Delete')),
            ],
          ),
        ],
      ),
    );
  }
}

class _GoalRow extends ConsumerStatefulWidget {
  const _GoalRow({required this.goal, required this.data});

  final WeeklyGoal goal;
  final AppData data;

  @override
  ConsumerState<_GoalRow> createState() => _GoalRowState();
}

class _GoalRowState extends ConsumerState<_GoalRow> {
  bool _busy = false;

  Future<void> _step(int delta) async {
    if (_busy) return;
    setState(() => _busy = true);
    await HapticFeedback.selectionClick();
    final WeeklyGoal goal = widget.goal;
    final double next = (goal.progressValue + delta).clamp(0, 999999).toDouble();
    try {
      await ref.read(dataControllerProvider.notifier).saveGoal(WeeklyGoal(
            id: goal.id,
            userId: goal.userId,
            goalType: goal.goalType,
            title: goal.title,
            target: goal.target,
            progressValue: next,
            weekStart: goal.weekStart,
            unit: goal.unit,
            createdAt: goal.createdAt,
            updatedAt: isoNow(),
          ));
      if (mounted) showToast(context, 'Weekly goal saved.');
    } catch (error) {
      if (mounted) showToast(context, 'Could not save goal.', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final WeeklyGoal goal = widget.goal;
    final double current = goalProgress(goal, widget.data);
    final double pct = goal.target > 0 ? (current / goal.target * 100).clamp(0, 100).toDouble() : 0;
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(child: Text(goal.title, style: text.titleSmall)),
              IconButton(
                tooltip: 'Delete ${goal.title} goal',
                icon: const Icon(Icons.delete_outline, size: 17),
                onPressed: () async {
                  try {
                    await ref.read(dataControllerProvider.notifier).deleteGoal(goal);
                    if (context.mounted) showToast(context, 'Goal deleted.');
                  } catch (error) {
                    if (context.mounted) showToast(context, 'Could not delete goal.', error: true);
                  }
                },
              ),
            ],
          ),
          Row(
            children: <Widget>[
              Expanded(child: Text('${numberLabel(current, digits: 1)} ${goal.unit}', style: text.bodyMedium)),
              Text('of ${numberLabel(goal.target, digits: 1)} ${goal.unit}',
                  style: text.labelSmall?.copyWith(color: colors.muted)),
            ],
          ),
          const SizedBox(height: 4),
          LinearBar(value: pct / 100, height: 6),
          Row(
            children: <Widget>[
              Expanded(
                child: Text('${pct.round()}% of target', style: text.labelSmall?.copyWith(color: colors.muted)),
              ),
              if (goal.goalType == 'custom') ...<Widget>[
                IconButton(
                  tooltip: 'Decrease ${goal.title} progress',
                  onPressed: _busy ? null : () => _step(-1),
                  icon: const Icon(Icons.remove, size: 17),
                ),
                IconButton(
                  tooltip: 'Increase ${goal.title} progress',
                  onPressed: _busy ? null : () => _step(1),
                  icon: const Icon(Icons.add, size: 17),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

/// Chapter picker options like the website: only the chosen subject's chapters, or every
/// chapter grouped under its subject when no subject is chosen.
List<SelectOption<String>> chapterOptions(AppData data, List<String> subjects, String? subject) {
  if (subject != null) {
    return <SelectOption<String>>[
      for (final Chapter c in data.chapters.where((Chapter c) => c.subject == subject))
        SelectOption<String>(c.id, c.name),
    ];
  }
  return <SelectOption<String>>[
    for (final String group in subjects)
      if (data.chapters.any((Chapter c) => c.subject == group)) ...<SelectOption<String>>[
        SelectOption<String>.header(group),
        for (final Chapter c in data.chapters.where((Chapter c) => c.subject == group))
          SelectOption<String>(c.id, c.name),
      ],
  ];
}

/// The website's TaskDialog: "Plan a study task" / "Edit your task".
Future<void> openTaskEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  DailyTask? task,
  String date,
) async {
  final bool creating = task == null;
  final TextEditingController title = TextEditingController(text: task?.title ?? '');
  final TextEditingController minutes = TextEditingController(text: '${task?.estimatedMinutes ?? 30}');
  final TextEditingController topic = TextEditingController(text: task?.topic ?? '');
  final String id = task?.id ?? newId();
  String priority = task?.priority ?? 'Medium';
  String? subject = task?.subject;
  String? chapterId = task?.chapterId;
  String taskDate = task?.taskDate ?? date;
  Map<String, String> errors = <String, String>{};
  bool saving = false;
  final List<String> subjects = examSubjectsWith(data, task?.subject);

  await showAppSheet<void>(
    context,
    title: creating ? 'Plan a study task' : 'Edit your task',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) {
        void clear(String key) {
          if (errors.containsKey(key)) setSheetState(() => errors = <String, String>{...errors}..remove(key));
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            AppField(
              label: 'Task',
              controller: title,
              required: true,
              maxLength: 200,
              error: errors['title'],
              hint: 'e.g. Practice 15 integration problems',
              onChanged: (_) => clear('title'),
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: AppDateField(
                    label: 'Date',
                    value: taskDate,
                    onChanged: (String? value) {
                      if (value != null) setSheetState(() => taskDate = value);
                      clear('task_date');
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: AppField(
                    label: 'Estimated minutes',
                    controller: minutes,
                    keyboardType: TextInputType.number,
                    inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                    error: errors['estimated_minutes'],
                    onChanged: (_) => clear('estimated_minutes'),
                  ),
                ),
              ],
            ),
            AppOptionSelect<String>(
              label: 'Subject',
              value: subject,
              nullLabel: 'General',
              options: <SelectOption<String>>[for (final String s in subjects) SelectOption<String>(s, s)],
              onChanged: (String? value) => setSheetState(() {
                subject = value;
                chapterId = null;
              }),
            ),
            AppOptionSelect<String>(
              label: 'Chapter',
              value: chapterId,
              nullLabel: 'None',
              error: errors['chapter_id'],
              options: chapterOptions(data, subjects, subject),
              onChanged: (String? value) {
                setSheetState(() => chapterId = value);
                clear('chapter_id');
              },
            ),
            AppSelect<String>(
              label: 'Priority',
              value: priority,
              items: const <String>['High', 'Medium', 'Low'],
              onChanged: (String? value) => setSheetState(() => priority = value ?? priority),
            ),
            AppField(
              label: 'Topic / subtopic',
              controller: topic,
              maxLength: 120,
              hint: 'Optional',
              helper: topicHint(topic.text.length),
              error: errors['topic'],
              onChanged: (_) {
                setSheetState(() {});
                clear('topic');
              },
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
                          final Map<String, String> next = taskProblems(
                            title: title.text,
                            topic: topic.text,
                            minutes: minutes.text,
                            date: taskDate,
                            subject: subject,
                            chapterId: chapterId,
                            chapters: data.chapters,
                          );
                          if (next.isNotEmpty) {
                            setSheetState(() => errors = next);
                            showToast(context, 'Please correct the highlighted task fields.', error: true);
                            await HapticFeedback.mediumImpact();
                            return;
                          }
                          setSheetState(() => saving = true);
                          final DailyTask saved = DailyTask(
                            id: id,
                            userId: data.userId,
                            title: title.text.trim(),
                            subject: subject,
                            chapterId: chapterId,
                            topic: topic.text.trim().isEmpty ? null : topic.text.trim(),
                            estimatedMinutes: int.parse(minutes.text.trim()),
                            priority: priority,
                            isCompleted: task?.isCompleted ?? false,
                            taskDate: taskDate,
                            position: task?.position ?? data.tasksOn(taskDate).length,
                            createdAt: task?.createdAt ?? isoNow(),
                            updatedAt: isoNow(),
                          );
                          try {
                            await ref.read(dataControllerProvider.notifier).saveTask(saved);
                            await HapticFeedback.lightImpact();
                            if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                            if (context.mounted) {
                              showToast(context, creating ? 'Task added to your plan.' : 'Task updated.');
                            }
                          } catch (error) {
                            if (context.mounted) showToast(context, 'Could not save task.', error: true);
                            setSheetState(() => saving = false);
                          }
                        },
                  child: Text(saving ? 'Saving…' : (creating ? 'Add task' : 'Save task')),
                ),
              ],
            ),
          ],
        );
      },
    ),
    onDisposed: () {
      title.dispose();
      minutes.dispose();
      topic.dispose();
    },
  );
}

/// The website's QuickTaskDialog from the quick-action menu: "Add a task" for today.
Future<void> openQuickTask(BuildContext context, WidgetRef ref) async {
  final AppData data = ref.read(dataControllerProvider).data;
  final TextEditingController title = TextEditingController();
  final TextEditingController minutes = TextEditingController(text: '30');
  final String id = newId();
  String? subject;
  String? chapterId;
  String priority = 'Medium';
  Map<String, String> errors = <String, String>{};
  bool saving = false;
  final List<String> subjects = examSubjectNames(data);

  await showAppSheet<void>(
    context,
    title: 'Add a task',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppField(
            label: 'What do you want to do?',
            controller: title,
            required: true,
            maxLength: 200,
            hint: 'e.g. Revise Kirchhoff\'s laws',
            error: errors['title'],
            onChanged: (_) {
              if (errors.containsKey('title')) {
                setSheetState(() => errors = <String, String>{...errors}..remove('title'));
              }
            },
          ),
          AppOptionSelect<String>(
            label: 'Subject',
            value: subject,
            nullLabel: 'General',
            options: <SelectOption<String>>[for (final String s in subjects) SelectOption<String>(s, s)],
            onChanged: (String? value) => setSheetState(() {
              subject = value;
              chapterId = null;
            }),
          ),
          AppOptionSelect<String>(
            label: 'Chapter',
            value: chapterId,
            nullLabel: 'Choose chapter',
            options: <SelectOption<String>>[
              for (final Chapter c in data.chapters.where((Chapter c) => subject == null || c.subject == subject))
                SelectOption<String>(c.id, c.name),
            ],
            onChanged: (String? value) => setSheetState(() => chapterId = value),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: AppField(
                  label: 'Estimated time (min)',
                  controller: minutes,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                  error: errors['estimated_minutes'],
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
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: <Widget>[
              TextButton(onPressed: () => Navigator.of(sheetContext).pop(), child: const Text('Cancel')),
              const SizedBox(width: 8),
              ElevatedButton.icon(
                onPressed: saving
                    ? null
                    : () async {
                        final String today = todayIso();
                        final Map<String, String> next = taskProblems(
                          title: title.text,
                          topic: '',
                          minutes: minutes.text,
                          date: today,
                          subject: subject,
                          chapterId: chapterId,
                          chapters: data.chapters,
                        );
                        final String? chapterProblem = next.remove('chapter_id');
                        if (next.isNotEmpty) {
                          setSheetState(() => errors = next);
                          showToast(context, 'Please correct the highlighted task fields.', error: true);
                          await HapticFeedback.mediumImpact();
                          return;
                        }
                        if (chapterProblem != null) {
                          showToast(context, chapterProblem, error: true);
                          return;
                        }
                        setSheetState(() => saving = true);
                        try {
                          await ref.read(dataControllerProvider.notifier).saveTask(DailyTask(
                                id: id,
                                userId: data.userId,
                                title: title.text.trim(),
                                subject: subject,
                                chapterId: chapterId,
                                estimatedMinutes: int.parse(minutes.text.trim()),
                                priority: priority,
                                taskDate: today,
                                position: data.tasksOn(today).length,
                                createdAt: isoNow(),
                                updatedAt: isoNow(),
                              ));
                          await HapticFeedback.lightImpact();
                          if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                          if (context.mounted) showToast(context, 'Task added to today.');
                        } catch (error) {
                          if (context.mounted) showToast(context, 'Could not save task. Retry.', error: true);
                          setSheetState(() => saving = false);
                        }
                      },
                icon: const Icon(Icons.check, size: 16),
                label: Text(saving ? 'Saving…' : 'Add to today'),
              ),
            ],
          ),
        ],
      ),
    ),
    onDisposed: () {
      title.dispose();
      minutes.dispose();
    },
  );
}

/// The website's GoalDialog: "Set a weekly goal" for the shown week.
Future<void> openGoalEditor(BuildContext context, WidgetRef ref, AppData data, String weekStart) async {
  String type = 'study_hours';
  final TextEditingController title = TextEditingController(text: 'Study hours');
  final TextEditingController target = TextEditingController(text: '10');
  final TextEditingController unit = TextEditingController(text: 'hours');
  final String id = newId();
  Map<String, String> errors = <String, String>{};
  bool saving = false;

  await showAppSheet<void>(
    context,
    title: 'Set a weekly goal',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) {
        final bool hours = type == 'study_hours';
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text('For the week of ${prettyDate(weekStart)}.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: context.stracker.muted)),
            ),
            AppSelect<String>(
              label: 'Goal type',
              value: type,
              items: <String>[for (final GoalTypeOption o in goalTypes) o.type],
              labelFor: (String v) => goalTypes.firstWhere((GoalTypeOption o) => o.type == v).title,
              onChanged: (String? value) {
                if (value == null) return;
                final GoalTypeOption option = goalTypes.firstWhere((GoalTypeOption o) => o.type == value);
                setSheetState(() {
                  type = value;
                  title.text = option.title;
                  unit.text = option.unit;
                  errors = <String, String>{};
                });
              },
            ),
            AppField(label: 'Name', controller: title, maxLength: 120, error: errors['title']),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: AppField(
                    label: 'Target',
                    controller: target,
                    keyboardType: TextInputType.numberWithOptions(decimal: hours),
                    hint: hours ? '0.5 – 168' : '1 – 999999',
                    error: errors['target'],
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(child: AppField(label: 'Unit', controller: unit, maxLength: 30)),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                'Study hours, tests, chapters and revisions update from your real activity. Custom goals can be '
                'ticked up manually.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: context.stracker.muted),
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
                          final Map<String, String> next =
                              goalProblems(type: type, title: title.text, target: target.text);
                          if (next.isNotEmpty) {
                            setSheetState(() => errors = next);
                            showToast(context, 'Please correct the highlighted goal fields.', error: true);
                            await HapticFeedback.mediumImpact();
                            return;
                          }
                          setSheetState(() => saving = true);
                          try {
                            await ref.read(dataControllerProvider.notifier).saveGoal(WeeklyGoal(
                                  id: id,
                                  userId: data.userId,
                                  goalType: type,
                                  title: title.text.trim(),
                                  target: double.parse(target.text.trim()),
                                  weekStart: weekStart,
                                  unit: unit.text,
                                  createdAt: isoNow(),
                                  updatedAt: isoNow(),
                                ));
                            await HapticFeedback.lightImpact();
                            if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                            if (context.mounted) showToast(context, 'Weekly goal saved.');
                          } catch (error) {
                            if (context.mounted) showToast(context, 'Could not save goal.', error: true);
                            setSheetState(() => saving = false);
                          }
                        },
                  child: Text(saving ? 'Saving…' : 'Save weekly goal'),
                ),
              ],
            ),
          ],
        );
      },
    ),
    onDisposed: () {
      title.dispose();
      target.dispose();
      unit.dispose();
    },
  );
}
