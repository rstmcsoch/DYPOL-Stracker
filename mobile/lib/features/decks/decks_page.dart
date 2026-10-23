import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/iterables.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/cards.dart';
import '../shell/app_shell.dart';

/// Formulas and flashcards. Each card moves along the R1 → R7 → R30 ladder; a difficult
/// rating holds it on the shorter rung, exactly like the website's decks page.
class DecksPage extends ConsumerStatefulWidget {
  const DecksPage({super.key});

  @override
  ConsumerState<DecksPage> createState() => _DecksPageState();
}

class _DecksPageState extends ConsumerState<DecksPage> {
  String _kind = 'flashcard';
  bool _dueOnly = true;
  String? _chapterId;
  bool _revealed = false;

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final String today = todayIso();
    final List<StudyCard> all = data.studyCards.where((StudyCard card) => card.kind == _kind).toList();
    final List<StudyCard> due = dueCards(all, today: today);
    final List<StudyCard> visible = (_dueOnly ? due : all)
        .where((StudyCard card) => _chapterId == null || card.chapterId == _chapterId)
        .toList();
    final StudyCard? current = visible.firstOrNull;

    return SectionPage(
      title: 'Formulas & flashcards',
      subtitle: '${all.length} ${_kind == 'formula' ? 'formulas' : 'flashcards'} · ${due.length} due',
      actions: <Widget>[
        IconButton(
          tooltip: 'Add card',
          icon: const Icon(Icons.add, size: 22),
          onPressed: () => openCardEditor(context, ref, data, null, _kind),
        ),
      ],
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: ChoiceRow<String>(
                  label: 'Deck',
                  value: _kind,
                  options: const <String>['flashcard', 'formula'],
                  labelFor: (String value) => value == 'formula' ? 'Formulas' : 'Flashcards',
                  onChanged: (String value) => setState(() {
                    _kind = value;
                    _revealed = false;
                  }),
                ),
              ),
            ],
          ),
          SwitchRow(
            title: 'Due only',
            subtitle: 'Today’s ladder rung has arrived.',
            value: _dueOnly,
            onChanged: (bool value) => setState(() => _dueOnly = value),
          ),
          AppSelect<String?>(
            label: 'Chapter',
            value: _chapterId,
            items: <String?>[
              null,
              ...data.chapters
                  .where((Chapter chapter) =>
                      all.any((StudyCard card) => card.chapterId == chapter.id))
                  .map((Chapter chapter) => chapter.id),
            ],
            labelFor: (String? value) => value == null ? 'All chapters' : data.chapterName(value),
            onChanged: (String? value) => setState(() {
              _chapterId = value;
              _revealed = false;
            }),
          ),
          if (current == null)
            NotebookCard(
              child: EmptyState(
                title: all.isEmpty ? 'This deck is empty' : 'Nothing due right now',
                message: all.isEmpty
                    ? 'Add the formulas you keep forgetting, or the facts you want to recall cold. '
                        'Cards resurface on the R1 / R7 / R30 ladder.'
                    : 'Come back when the next rung is due, or switch “Due only” off to review early.',
                icon: Icons.style_outlined,
                action: ElevatedButton(
                  onPressed: () => openCardEditor(context, ref, data, null, _kind),
                  child: const Text('Add a card'),
                ),
              ),
            )
          else ...<Widget>[
            NotebookCard(
              title: data.chapterName(current.chapterId),
              subtitle: '${cardLadderLabel(current)} · reviewed ${current.reviews} '
                  'time${current.reviews == 1 ? '' : 's'}'
                  '${current.difficulty == null ? '' : ' · ${current.difficulty}'}',
              accent: colors.subjectColor(
                data.chapter(current.chapterId)?.subject ?? 'Physics',
              ),
              trailing: IconButton(
                tooltip: 'Edit card',
                icon: const Icon(Icons.edit_outlined, size: 18),
                onPressed: () => openCardEditor(context, ref, data, current, _kind),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(current.front, style: Theme.of(context).textTheme.headlineSmall),
                  if (current.hint.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        current.hint,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                      ),
                    ),
                  const SizedBox(height: 10),
                  if (!_revealed)
                    OutlinedButton(
                      onPressed: () => setState(() => _revealed = true),
                      child: const Text('Show answer'),
                    )
                  else ...<Widget>[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: colors.palette.paperSoft,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: colors.palette.line),
                      ),
                      child: Text(current.back, style: Theme.of(context).textTheme.bodyMedium),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'How did that feel?',
                      style: Theme.of(context).textTheme.labelMedium,
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: <Widget>[
                        for (final String rating in const <String>['difficult', 'okay', 'easy'])
                          Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: OutlinedButton(
                              onPressed: () => _review(context, ref, data, current, rating),
                              child: Text(rating),
                            ),
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 8),
                  Text(
                    current.nextReviewAt == null
                        ? 'Never reviewed — showing now.'
                        : 'Next up ${current.nextReviewAt!.substring(0, 10)}',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            if (visible.length > 1)
              NotebookCard(
                title: 'Rest of this deck',
                subtitle: '${visible.length - 1} more in view',
                child: Column(
                  children: <Widget>[
                    for (final StudyCard card in visible.skip(1).take(20))
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: Text(
                          card.front,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        subtitle: Text(
                          data.chapterName(card.chapterId),
                          style: Theme.of(context).textTheme.labelSmall,
                        ),
                        trailing: Text(cardLadderLabel(card)),
                        onTap: () => openCardEditor(context, ref, data, card, _kind),
                      ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }

  Future<void> _review(
    BuildContext context,
    WidgetRef ref,
    AppData data,
    StudyCard card,
    String rating,
  ) async {
    final StudyCard next = reviewCard(card, rating);
    try {
      await ref.read(dataControllerProvider.notifier).saveCard(next);
      if (!mounted) return;
      setState(() => _revealed = false);
      showToast(context, 'Next review in ${next.nextReviewAt!.substring(0, 10)}.');
    } catch (error) {
      if (mounted) showToast(context, error.toString(), error: true);
    }
  }
}

Future<void> openCardEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  StudyCard? card,
  String kind,
) async {
  if (data.chapters.isEmpty) {
    showToast(context, 'Add a chapter in the syllabus first.', error: true);
    return;
  }
  final bool creating = card == null;
  final TextEditingController front = TextEditingController(text: card?.front ?? '');
  final TextEditingController back = TextEditingController(text: card?.back ?? '');
  final TextEditingController hint = TextEditingController(text: card?.hint ?? '');
  String chapterId = card?.chapterId ?? data.chapters.first.id;
  String cardKind = card?.kind ?? kind;

  await showAppSheet<void>(
    context,
    title: creating ? 'Add a card' : 'Edit card',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppSelect<String>(
            label: 'Deck',
            value: cardKind,
            items: const <String>['flashcard', 'formula'],
            labelFor: (String value) => value == 'formula' ? 'Formula' : 'Flashcard',
            onChanged: (String? value) => setSheetState(() => cardKind = value ?? cardKind),
          ),
          AppSelect<String>(
            label: 'Chapter',
            value: chapterId,
            items: <String>[for (final Chapter chapter in data.chapters) chapter.id],
            labelFor: (String id) => data.chapterName(id),
            onChanged: (String? value) => setSheetState(() => chapterId = value ?? chapterId),
          ),
          AppField(
            label: cardKind == 'formula' ? 'Formula / front' : 'Question / front',
            controller: front,
            required: true,
            maxLines: 2,
            maxLength: 600,
          ),
          AppField(label: 'Answer / back', controller: back, required: true, maxLines: 4, maxLength: 4000),
          AppField(label: 'Hint (optional)', controller: hint, maxLength: 300),
          ElevatedButton(
            onPressed: () async {
              if (front.text.trim().isEmpty || back.text.trim().isEmpty) {
                showToast(context, 'A card needs a front and a back.', error: true);
                return;
              }
              final StudyCard next = StudyCard(
                id: card?.id ?? newId(),
                userId: data.userId,
                chapterId: chapterId,
                kind: cardKind,
                front: front.text.trim(),
                back: back.text.trim(),
                hint: hint.text.trim(),
                position: card?.position ?? data.studyCards.length,
                difficulty: card?.difficulty,
                reviews: card?.reviews ?? 0,
                lastReviewedAt: card?.lastReviewedAt,
                nextReviewAt: card?.nextReviewAt,
                createdAt: card?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref.read(dataControllerProvider.notifier).saveCard(next);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, creating ? 'Card added.' : 'Card saved.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: Text(creating ? 'Add card' : 'Save'),
          ),
          if (!creating)
            TextButton(
              onPressed: () async {
                final bool confirmed = await confirmAction(
                  context,
                  title: 'Delete this card?',
                  message: 'Its review history is removed with it, on the website too.',
                );
                if (!confirmed) return;
                try {
                  await ref.read(dataControllerProvider.notifier).deleteCard(card!);
                  if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                  if (context.mounted) showToast(context, 'Card deleted.');
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
  front.dispose();
  back.dispose();
  hint.dispose();
}
