import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/errors.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/buttons.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/recommend.dart';
import '../../logic/search.dart';
import '../search/search_focus.dart';
import '../shell/app_shell.dart';

/// Backlog: topics that slipped, with priority, due dates and snoozing. Only awake
/// items feed the study-now ranking, exactly like the website.
class BacklogPage extends ConsumerStatefulWidget {
  const BacklogPage({super.key});

  @override
  ConsumerState<BacklogPage> createState() => _BacklogPageState();
}

const Map<String, int> _priorityRank = <String, int>{'High': 0, 'Medium': 1, 'Low': 2};
const List<String> backlogTypes = <String>['Lecture', 'DPP', 'Topic'];
String backlogTypeLabel(String type) => type == 'DPP'
    ? 'Unsolved DPPs'
    : type == 'Lecture'
        ? 'Skipped lectures'
        : 'Come back to';

/// Website `groupItems`: overdue first, then dates ascending; inside a group by priority, due date, title.
List<({String title, List<BacklogItem> items})> groupBacklog(
  List<BacklogItem> items,
  String groupBy,
  AppData data,
  String today,
) {
  final Map<String, ({String title, String sort, List<BacklogItem> items})> buckets =
      <String, ({String title, String sort, List<BacklogItem> items})>{};
  void put(String key, String title, String sort, BacklogItem item) =>
      (buckets[key] ??= (title: title, sort: sort, items: <BacklogItem>[])).items.add(item);
  for (final BacklogItem item in items) {
    if (groupBy == 'Subject') {
      final String subject = item.subject ?? data.chapter(item.chapterId)?.subject ?? 'General';
      final int jee = const <String>['Physics', 'Chemistry', 'Maths'].indexOf(subject);
      put(subject, subject, subject == 'General' ? '~' : (jee >= 0 ? '$jee' : '9$subject'), item);
    } else if (groupBy == 'Type') {
      put(item.type, backlogTypeLabel(item.type), '${backlogTypes.indexOf(item.type)}', item);
    } else if (groupBy == 'Priority') {
      put(item.priority, '${item.priority} priority', '${_priorityRank[item.priority] ?? 1}', item);
    } else {
      final String? due = item.dueOn;
      if (due == null) {
        put('none', 'No due date', '9', item);
      } else if (due.compareTo(today) < 0) {
        put('overdue', 'Overdue', '0', item);
      } else if (due == today) {
        put('today', 'Due today', '1', item);
      } else {
        put('d-$due', 'Due ${formatDate(due)}', '2$due', item);
      }
    }
  }
  final List<({String title, String sort, List<BacklogItem> items})> sorted = buckets.values.toList()
    ..sort((a, b) => a.sort.compareTo(b.sort));
  return <({String title, List<BacklogItem> items})>[
    for (final ({String title, String sort, List<BacklogItem> items}) bucket in sorted)
      (
        title: bucket.title,
        items: bucket.items.toList()
          ..sort((BacklogItem a, BacklogItem b) {
            final int p = (_priorityRank[a.priority] ?? 1).compareTo(_priorityRank[b.priority] ?? 1);
            if (p != 0) return p;
            final int d = (a.dueOn ?? '9999').compareTo(b.dueOn ?? '9999');
            return d != 0 ? d : a.title.compareTo(b.title);
          }),
      ),
  ];
}

class _BacklogPageState extends ConsumerState<BacklogPage> {
  String _type = 'all';
  String? _subject;
  String? _priority;
  String _groupBy = 'Due date';
  bool _showDone = false;

  /// Cleared items are listed a page at a time so a long history stays quick to scroll.
  static const int _donePage = 30;
  int _doneShown = _donePage;

  /// A cleared item opened from search, revealed even when it sits beyond the first page.
  String? _focusDoneId;

  @override
  void initState() {
    super.initState();
    // Opened from a search result for a cleared item: expand the cleared list.
    final SearchFocus? focus = SearchFocusScope.of(context);
    if (focus != null && focus.kind == SearchKind.backlog) {
      _showDone = ref
          .read(dataControllerProvider)
          .data
          .backlogItems
          .any((BacklogItem item) => item.id == focus.id && item.isDone);
      if (_showDone) _focusDoneId = focus.id;
    }
  }

  /// How many cleared items to list: the current page, stretched to include a searched item.
  int _doneVisible(List<BacklogItem> completed) {
    final String? focusId = _focusDoneId;
    if (focusId != null) {
      final int index = completed.indexWhere((BacklogItem item) => item.id == focusId);
      if (index >= _doneShown) _doneShown = ((index ~/ _donePage) + 1) * _donePage;
      _focusDoneId = null;
    }
    return math.min(_doneShown, completed.length);
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final String today = todayIso();
    bool matches(BacklogItem item) {
      if (_type != 'all' && item.type != _type) return false;
      if (_priority != null && item.priority != _priority) return false;
      if (_subject != null && (item.subject ?? data.chapter(item.chapterId)?.subject) != _subject) return false;
      return true;
    }

    final List<BacklogItem> open = data.backlogItems.where((BacklogItem i) => !i.isDone && matches(i)).toList();
    final List<BacklogItem> active = open.where((BacklogItem i) => isBacklogAwake(i, today)).toList();
    final List<BacklogItem> snoozed =
        open.where((BacklogItem i) => i.status == 'snoozed' && !isBacklogAwake(i, today)).toList();
    final List<BacklogItem> completed = data.backlogItems.where((BacklogItem i) => i.isDone && matches(i)).toList()
      ..sort((BacklogItem a, BacklogItem b) => (b.completedAt ?? '').compareTo(a.completedAt ?? ''));
    final List<BacklogItem> dueNow =
        active.where((BacklogItem i) => i.dueOn != null && i.dueOn!.compareTo(today) <= 0).toList();
    final int overdue = dueNow.where((BacklogItem i) => i.dueOn!.compareTo(today) < 0).length;
    final int cleared = data.backlogItems.where((BacklogItem i) => i.isDone).length;
    final List<({String title, List<BacklogItem> items})> groups = groupBacklog(active, _groupBy, data, today);

    return SectionPage(
      title: 'Backlog',
      subtitle: 'Skipped lectures, unsolved DPPs and topics to revisit.',
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => openBacklogEditor(context, ref, data, null),
        backgroundColor: colors.palette.accentDark,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add, size: 19),
        label: const Text('Add item'),
      ),
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          WrapGrid(
            minItemWidth: 140,
            children: <Widget>[
              StatTile(
                value: '${dueNow.length}',
                label: 'Due now',
                hint: overdue > 0 ? '$overdue overdue' : 'nothing overdue',
                tone: overdue > 0 ? colors.palette.red : null,
              ),
              StatTile(value: '${active.length}', label: 'Open', hint: 'active items'),
              StatTile(value: '${snoozed.length}', label: 'Snoozed', hint: 'waiting to come back'),
              StatTile(value: '$cleared', label: 'Cleared', hint: 'completed'),
            ],
          ),
          const SizedBox(height: 10),
          ChoiceRow<String>(
            label: 'Type',
            value: _type,
            options: const <String>['all', ...backlogTypes],
            labelFor: (String value) => value == 'all' ? 'All' : backlogTypeLabel(value),
            onChanged: (String value) => setState(() => _type = value),
          ),
          AppSelect<String?>(
            label: 'Subject',
            value: _subject,
            items: <String?>[null, ...data.subjects],
            labelFor: (String? value) => value ?? 'All subjects',
            onChanged: (String? value) => setState(() => _subject = value),
          ),
          Row(
            children: <Widget>[
              Expanded(
                child: AppSelect<String?>(
                  label: 'Priority',
                  value: _priority,
                  items: const <String?>[null, 'High', 'Medium', 'Low'],
                  labelFor: (String? value) => value ?? 'Any priority',
                  onChanged: (String? value) => setState(() => _priority = value),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppSelect<String>(
                  label: 'Group by',
                  value: _groupBy,
                  items: const <String>['Due date', 'Subject', 'Type', 'Priority'],
                  onChanged: (String? value) => setState(() => _groupBy = value ?? _groupBy),
                ),
              ),
            ],
          ),
          if (data.backlogItems.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: 'Backlog is empty.',
                icon: Icons.check,
                action: OutlinedButton.icon(
                  onPressed: () => openBacklogEditor(context, ref, data, null),
                  icon: const Icon(Icons.add, size: 17),
                  label: const Text('Add the first item'),
                ),
              ),
            )
          else ...<Widget>[
            if (groups.isEmpty)
              const NotebookCard(child: EmptyState(title: 'Nothing open in this view.', icon: Icons.check)),
            for (final ({String title, List<BacklogItem> items}) group in groups) ...<Widget>[
              SectionHeading(
                group.title,
                trailing: _note(context, '${group.items.length} item${group.items.length == 1 ? '' : 's'}'),
              ),
              for (final BacklogItem item in group.items)
                SearchTarget(id: item.id, child: _BacklogTile(item: item, data: data, today: today)),
            ],
            if (snoozed.isNotEmpty) ...<Widget>[
              SectionHeading('Snoozed', trailing: _note(context, 'Returns automatically on its date.')),
              for (final BacklogItem item in snoozed)
                SearchTarget(id: item.id, child: _BacklogTile(item: item, data: data, today: today)),
            ],
            NotebookCard(
              dense: true,
              title: 'Completed',
              subtitle: '${completed.length} cleared item${completed.length == 1 ? '' : 's'}',
              trailing: TextButton.icon(
                onPressed: () => setState(() => _showDone = !_showDone),
                icon: Icon(_showDone ? Icons.expand_less : Icons.expand_more, size: 18),
                label: Text(_showDone ? 'Hide' : 'Show'),
              ),
              child: const SizedBox.shrink(),
            ),
            if (_showDone) ...<Widget>[
              for (final BacklogItem item in completed.take(_doneVisible(completed)))
                SearchTarget(id: item.id, child: _BacklogTile(item: item, data: data, today: today)),
              if (completed.length > _doneVisible(completed))
                Padding(
                  padding: const EdgeInsets.only(top: 4, bottom: 8),
                  child: Center(
                    child: SecondaryButton(
                      key: const ValueKey<String>('backlog-show-more-done'),
                      icon: Icons.expand_more,
                      label: 'Show ${math.min(_donePage, completed.length - _doneVisible(completed))} more '
                          '(${completed.length - _doneVisible(completed)} left)',
                      onPressed: () => setState(() => _doneShown = _doneVisible(completed) + _donePage),
                    ),
                  ),
                ),
            ],
          ],
          const SizedBox(height: 10),
          InfoBanner(
            'Snoozed items stop feeding “what should I study now” until their snooze date. Overdue '
            'high-priority items rank highest inside the backlog tier.',
          ),
        ],
      ),
    );
  }
}

Widget _note(BuildContext context, String text) =>
    Text(text, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: context.stracker.muted));

class _BacklogTile extends ConsumerWidget {
  const _BacklogTile({required this.item, required this.data, required this.today});

  final BacklogItem item;
  final AppData data;
  final String today;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final bool overdue = item.dueOn != null && isPast(item.dueOn!);
    final bool awake = isBacklogAwake(item, today);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: NotebookCard(
        dense: true,
        accent: item.priority == 'High' ? colors.palette.red : null,
        onTap: () => openBacklogEditor(context, ref, data, item),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    item.title,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          decoration: item.isDone ? TextDecoration.lineThrough : null,
                        ),
                  ),
                ),
                Pill(
                  item.priority,
                  tone: item.priority == 'High'
                      ? PillTone.bad
                      : (item.priority == 'Low' ? PillTone.neutral : PillTone.warn),
                  dense: true,
                ),
              ],
            ),
            const SizedBox(height: 3),
            Text(
              <String>[
                item.type,
                if ((item.subject ?? data.chapter(item.chapterId)?.subject) != null)
                  (item.subject ?? data.chapter(item.chapterId)?.subject)!,
                if (item.chapterId != null) data.chapterName(item.chapterId),
                if (item.dueOn != null)
                  overdue && !item.isDone ? 'overdue since ${formatDate(item.dueOn)}' : 'due ${formatDate(item.dueOn)}',
                if (item.status == 'snoozed' && item.snoozedUntil != null && !item.isDone)
                  'back ${formatDate(item.snoozedUntil)}',
                if (item.isDone && item.completedAt != null)
                  'cleared ${formatDate(item.completedAt!.substring(0, 10))}',
                if (!awake && !item.isDone && item.status != 'snoozed') 'not in today’s ranking',
              ].join(' · '),
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: overdue && !item.isDone ? colors.palette.red : colors.muted,
                  ),
            ),
            if (item.notes.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  item.notes,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                if (!item.isDone)
                  SecondaryButton(
                    compact: true,
                    icon: Icons.check,
                    label: 'Clear',
                    onPressed: () => _save(
                      context,
                      ref,
                      item.copyWithStatus('done', completedAt: isoNow()),
                      toast: 'Backlog item cleared. Nice.',
                    ),
                  ),
                if (!item.isDone && item.snoozedUntil != addDays(today, 1))
                  SecondaryButton(
                    compact: true,
                    icon: Icons.snooze,
                    label: 'Snooze until tomorrow',
                    onPressed: () => _snooze(context, ref, item, addDays(today, 1)),
                  ),
                if (!item.isDone)
                  PopupMenuButton<int>(
                    tooltip: 'Actions for ${item.title}',
                    icon: const Icon(Icons.more_horiz, size: 20),
                    onSelected: (int choice) {
                      if (choice > 0) {
                        _snooze(context, ref, item, addDays(today, choice));
                      } else if (choice == 0) {
                        openBacklogEditor(context, ref, data, item);
                      } else {
                        _delete(context, ref, item);
                      }
                    },
                    itemBuilder: (BuildContext context) => const <PopupMenuEntry<int>>[
                      PopupMenuItem<int>(value: 1, child: Text('Come back tomorrow')),
                      PopupMenuItem<int>(value: 3, child: Text('Come back in 3 days')),
                      PopupMenuItem<int>(value: 7, child: Text('Come back in a week')),
                      PopupMenuItem<int>(value: 0, child: Text('Edit')),
                      PopupMenuItem<int>(value: -1, child: Text('Delete')),
                    ],
                  ),
                if (item.status == 'snoozed' || item.isDone)
                  SecondaryButton(
                    compact: true,
                    icon: Icons.undo,
                    label: 'Reopen',
                    onPressed: () => _save(
                      context,
                      ref,
                      BacklogItem(
                        id: item.id,
                        userId: item.userId,
                        title: item.title,
                        type: item.type,
                        subject: item.subject,
                        chapterId: item.chapterId,
                        priority: item.priority,
                        dueOn: item.dueOn,
                        status: 'active',
                        notes: item.notes,
                        createdAt: item.createdAt,
                        updatedAt: isoNow(),
                      ),
                      toast: 'Reopened.',
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// One snooze write per item at a time; rapid repeat taps are ignored until it settles.
  static final Set<String> _snoozing = <String>{};

  Future<void> _snooze(BuildContext context, WidgetRef ref, BacklogItem item, String until) async {
    if (!_snoozing.add(item.id)) return;
    try {
      await _save(context, ref, item.copyWithStatus('snoozed', snoozedUntil: until),
          toast: 'Snoozed until ${formatDate(until)}.');
    } finally {
      _snoozing.remove(item.id);
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref, BacklogItem item) async {
    final bool confirmed =
        await confirmAction(context, title: 'Delete “${item.title}”?', message: 'It is removed from the website too.');
    if (!confirmed) return;
    try {
      await ref.read(dataControllerProvider.notifier).deleteBacklog(item);
      if (context.mounted) showToast(context, 'Removed.');
    } catch (error) {
      if (context.mounted) showToast(context, userMessage(error), error: true);
    }
  }

  Future<void> _save(BuildContext context, WidgetRef ref, BacklogItem next,
      {String toast = 'Backlog item updated.'}) async {
    try {
      await ref.read(dataControllerProvider.notifier).saveBacklog(next);
      if (context.mounted) showToast(context, toast);
    } catch (error) {
      if (context.mounted) showToast(context, userMessage(error), error: true);
    }
  }
}

extension on BacklogItem {
  BacklogItem copyWithStatus(String status, {String? snoozedUntil, String? completedAt}) => BacklogItem(
        id: id,
        userId: userId,
        title: title,
        type: type,
        subject: subject,
        chapterId: chapterId,
        priority: priority,
        dueOn: dueOn,
        status: status,
        snoozedUntil: snoozedUntil,
        completedAt: completedAt,
        notes: notes,
        createdAt: createdAt,
        updatedAt: isoNow(),
      );
}

Future<void> openBacklogEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  BacklogItem? item,
) async {
  final bool creating = item == null;
  final TextEditingController title = TextEditingController(text: item?.title ?? '');
  final TextEditingController notes = TextEditingController(text: item?.notes ?? '');
  // Old rows may carry a type the database no longer accepts; fall back to the website default.
  String type = backlogTypes.contains(item?.type) ? item!.type : 'Lecture';
  String? titleError;
  String priority = item?.priority ?? 'Medium';
  String? subject = item?.subject;
  String? chapterId = item?.chapterId;
  String? dueOn = item?.dueOn;

  await showAppSheet<void>(
    context,
    title: creating ? 'Add to backlog' : 'Edit backlog item',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppField(
            label: 'What is it?',
            controller: title,
            required: true,
            maxLength: 200,
            hint: 'e.g. Lecture 8 — EMI',
            error: titleError,
            onChanged: (_) {
              if (titleError != null) setSheetState(() => titleError = null);
            },
          ),
          Row(
            children: <Widget>[
              Expanded(
                child: AppSelect<String>(
                  label: 'Type',
                  value: type,
                  items: backlogTypes,
                  onChanged: (String? value) => setSheetState(() => type = value ?? type),
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
          AppSelect<String?>(
            label: 'Subject',
            value: subject,
            items: <String?>[null, ...examSubjectsWith(data, subject)],
            labelFor: (String? value) => value ?? 'Choose subject (optional)',
            // A subject change drops a linked chapter only when it belongs to another subject.
            onChanged: (String? value) => setSheetState(() {
              subject = value;
              final Chapter? linked = data.chapter(chapterId);
              if (linked != null && value != null && linked.subject != value) chapterId = null;
            }),
          ),
          AppSelect<String?>(
            label: 'Linked chapter (optional)',
            value: chapterId,
            items: <String?>[
              null,
              ...data.chapters
                  .where((Chapter chapter) => subject == null || chapter.subject == subject || chapter.id == chapterId)
                  .map((Chapter chapter) => chapter.id),
            ],
            labelFor: (String? value) {
              final Chapter? chapter = data.chapter(value);
              return chapter == null ? 'No chapter' : '${chapter.subject} · ${chapter.name}';
            },
            // A linked chapter brings its real subject, so the pair can never disagree.
            onChanged: (String? value) => setSheetState(() {
              chapterId = value;
              final Chapter? linked = data.chapter(value);
              if (linked != null) subject = linked.subject;
            }),
          ),
          AppDateField(
            label: 'Due date (optional)',
            value: dueOn,
            allowClear: true,
            onChanged: (String? value) => setSheetState(() => dueOn = value),
          ),
          AppField(label: 'Notes (optional)', controller: notes, maxLines: 2, maxLength: 5000),
          SaveButton(
            onPressed: () async {
              if (title.text.trim().isEmpty) {
                setSheetState(() => titleError = 'Give the item a short name, e.g. “Lecture 8 — EMI”.');
                showToast(context, 'Check the highlighted fields.', error: true);
                return;
              }
              final BacklogItem next = BacklogItem(
                id: item?.id ?? newId(),
                userId: data.userId,
                title: title.text.trim(),
                type: type,
                subject: subject,
                chapterId: chapterId,
                priority: priority,
                dueOn: dueOn,
                status: item?.status ?? 'active',
                snoozedUntil: item?.snoozedUntil,
                completedAt: item?.completedAt,
                notes: notes.text.trim(),
                createdAt: item?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref.read(dataControllerProvider.notifier).saveBacklog(next);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, creating ? 'Added to your backlog.' : 'Backlog item updated.');
              } catch (error) {
                if (context.mounted) showToast(context, userMessage(error), error: true);
              }
            },
            label: creating ? 'Add to backlog' : 'Save changes',
          ),
          if (!creating)
            DangerButton(
              label: 'Delete',
              onPressed: () async {
                final bool confirmed = await confirmAction(
                  context,
                  title: 'Delete this item?',
                  message: 'It is removed from the account on the website too.',
                );
                if (!confirmed) return;
                try {
                  await ref.read(dataControllerProvider.notifier).deleteBacklog(item);
                  if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                  if (context.mounted) showToast(context, 'Item deleted.');
                } catch (error) {
                  if (context.mounted) showToast(context, userMessage(error), error: true);
                }
              },
            ),
        ],
      ),
    ),
    onDisposed: () {
      title.dispose();
      notes.dispose();
    },
  );
}
