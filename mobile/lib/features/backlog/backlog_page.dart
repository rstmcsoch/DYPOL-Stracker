import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/recommend.dart';
import '../shell/app_shell.dart';

/// Backlog: topics that slipped, with priority, due dates and snoozing. Only awake
/// items feed the study-now ranking, exactly like the website.
class BacklogPage extends ConsumerStatefulWidget {
  const BacklogPage({super.key});

  @override
  ConsumerState<BacklogPage> createState() => _BacklogPageState();
}

class _BacklogPageState extends ConsumerState<BacklogPage> {
  String _view = 'Active';

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final String today = todayIso();
    final List<BacklogItem> all = data.backlogItems;
    final List<BacklogItem> active = all
        .where((BacklogItem item) => !item.isDone && item.status != 'snoozed')
        .toList()
      ..sort((BacklogItem a, BacklogItem b) {
        final String first = a.dueOn ?? '9999-12-31';
        final String second = b.dueOn ?? '9999-12-31';
        return first.compareTo(second);
      });
    final List<BacklogItem> snoozed = all
        .where((BacklogItem item) =>
            item.status == 'snoozed' &&
            (item.snoozedUntil == null || item.snoozedUntil!.compareTo(today) > 0))
        .toList();
    final List<BacklogItem> done = all.where((BacklogItem item) => item.isDone).toList();
    final List<BacklogItem> rows = switch (_view) {
      'Snoozed' => snoozed,
      'Done' => done,
      _ => active,
    };

    return SectionPage(
      title: 'Backlog',
      subtitle: '${active.length} active · ${snoozed.length} snoozed · ${done.length} cleared',
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
          ChoiceRow<String>(
            label: 'View',
            value: _view,
            options: const <String>['Active', 'Snoozed', 'Done'],
            onChanged: (String value) => setState(() => _view = value),
          ),
          if (rows.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: switch (_view) {
                  'Snoozed' => 'Nothing snoozed',
                  'Done' => 'Nothing cleared yet',
                  _ => 'No backlog',
                },
                message: 'A backlog item is a topic you owe yourself: a chapter you skipped, a module '
                    'you postponed, a topic you keep avoiding.',
                icon: Icons.layers_outlined,
                action: ElevatedButton(
                  onPressed: () => openBacklogEditor(context, ref, data, null),
                  child: const Text('Add item'),
                ),
              ),
            )
          else
            for (final BacklogItem item in rows) _BacklogTile(item: item, data: data, today: today),
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
                if (item.subject != null) item.subject!,
                if (item.chapterId != null) data.chapterName(item.chapterId),
                if (item.dueOn != null)
                  overdue && !item.isDone ? 'overdue since ${formatDate(item.dueOn)}' : 'due ${formatDate(item.dueOn)}',
                if (item.status == 'snoozed' && item.snoozedUntil != null)
                  'snoozed to ${formatDate(item.snoozedUntil)}',
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
            Row(
              children: <Widget>[
                if (!item.isDone)
                  TextButton(
                    onPressed: () => _save(
                      context,
                      ref,
                      item.copyWithStatus('done', completedAt: isoNow()),
                    ),
                    child: const Text('Clear'),
                  ),
                if (!item.isDone && item.status != 'snoozed')
                  TextButton(
                    onPressed: () => _save(
                      context,
                      ref,
                      item.copyWithStatus('snoozed', snoozedUntil: addDays(today, 3)),
                    ),
                    child: const Text('Snooze 3d'),
                  ),
                if (item.status == 'snoozed' || item.isDone)
                  TextButton(
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
                    ),
                    child: const Text('Reopen'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save(BuildContext context, WidgetRef ref, BacklogItem next) async {
    try {
      await ref.read(dataControllerProvider.notifier).saveBacklog(next);
      if (context.mounted) showToast(context, 'Backlog updated.');
    } catch (error) {
      if (context.mounted) showToast(context, error.toString(), error: true);
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
  String type = item?.type ?? 'Topic';
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
          AppField(label: 'What is it?', controller: title, required: true, maxLength: 160),
          Row(
            children: <Widget>[
              Expanded(
                child: AppSelect<String>(
                  label: 'Type',
                  value: type,
                  items: const <String>['Topic', 'Chapter', 'Module', 'Sheet', 'Test'],
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
            labelFor: (String? value) => value == null ? 'Not linked' : data.chapterName(value),
            onChanged: (String? value) => setSheetState(() => chapterId = value),
          ),
          AppDateField(
            label: 'Due by (optional)',
            value: dueOn,
            allowClear: true,
            onChanged: (String? value) => setSheetState(() => dueOn = value),
          ),
          AppField(label: 'Notes', controller: notes, maxLines: 3, maxLength: 5000),
          ElevatedButton(
            onPressed: () async {
              if (title.text.trim().isEmpty) {
                showToast(context, 'Give the item a name.', error: true);
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
                notes: notes.text,
                createdAt: item?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref.read(dataControllerProvider.notifier).saveBacklog(next);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, creating ? 'Added to backlog.' : 'Backlog saved.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: Text(creating ? 'Add item' : 'Save'),
          ),
          if (!creating)
            TextButton(
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
                  if (context.mounted) showToast(context, error.toString(), error: true);
                }
              },
              child: Text('Delete', style: TextStyle(color: context.stracker.palette.red)),
            ),
        ],
      ),
    ),
  );
  title.dispose();
  notes.dispose();
}
