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

/// Formulas and flashcards. Each card moves along the Settings revision ladder
/// (R1 → R7 → R30 by default) with Again / Hard / Good / Easy, exactly like the
/// website's decks page.
class DecksPage extends ConsumerStatefulWidget {
  const DecksPage({super.key});

  @override
  ConsumerState<DecksPage> createState() => _DecksPageState();
}

class _DecksPageState extends ConsumerState<DecksPage> {
  String _kind = 'all';
  final Map<String, int> _session = <String, int>{for (final String r in cardRatings) r: 0};
  bool _dueOnly = true;
  String? _subject;
  String? _chapterId;
  bool _revealed = false;

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final String today = todayIso();
    final List<StudyCard> all =
        data.studyCards.where((StudyCard card) => _kind == 'all' || card.kind == _kind).toList();
    final List<int> gaps = data.settings.revisionGaps;
    // A card's subject comes from its chapter.
    bool inSubject(StudyCard card) => _subject == null || data.chapter(card.chapterId)?.subject == _subject;
    final List<StudyCard> due = dueCards(all, today: today);
    final List<StudyCard> visible = (_dueOnly ? due : all)
        .where(inSubject)
        .where((StudyCard card) => _chapterId == null || card.chapterId == _chapterId)
        .toList();
    final List<String> cardSubjects = data.subjects
        .where((String subject) => all.any((StudyCard card) => data.chapter(card.chapterId)?.subject == subject))
        .toList();
    final StudyCard? current = visible.firstOrNull;
    final Chapter? openChapter = data.chapter(_chapterId);
    final int dueOverall = dueCards(data.studyCards, today: today).where(inSubject).length;
    final int dueChapter = openChapter == null
        ? 0
        : dueCards(data.studyCards, today: today).where((StudyCard card) => card.chapterId == openChapter.id).length;
    final int rated = _session.values.fold(0, (int sum, int n) => sum + n);
    final String newKind = _kind == 'all' ? 'formula' : _kind;

    return SectionPage(
      title: 'Formulas & flashcards',
      subtitle: 'Rate each card Again, Hard, Good or Easy; Good and Easy move it up your revision ladder.',
      actions: <Widget>[
        IconButton(
          tooltip: 'Add card',
          icon: const Icon(Icons.add, size: 22),
          onPressed: () =>
              openCardEditor(context, ref, data, null, newKind, initialChapterId: _chapterId, initialSubject: _subject),
        ),
      ],
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: StatTile(
                  value: '$dueOverall',
                  label: 'Due overall',
                  hint: _subject == null ? 'across all chapters' : 'across $_subject',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: StatTile(
                  value: '$dueChapter',
                  label: 'Due in this chapter',
                  hint: openChapter?.name ?? 'Pick a chapter',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: StatTile(
                  value: '${data.studyCards.length}',
                  label: 'Cards',
                  hint: 'formulas and flashcards',
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: <Widget>[
              Expanded(
                child: ChoiceRow<String>(
                  label: 'Deck',
                  value: _kind,
                  options: const <String>['all', 'formula', 'flashcard'],
                  labelFor: (String value) => value == 'all'
                      ? 'Both'
                      : value == 'formula'
                          ? 'Formulas'
                          : 'Flashcards',
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
            label: 'Subject',
            value: cardSubjects.contains(_subject) ? _subject : null,
            items: <String?>[null, ...cardSubjects],
            labelFor: (String? value) => value ?? 'All subjects',
            onChanged: (String? value) => setState(() {
              _subject = value;
              _chapterId = null;
              _revealed = false;
            }),
          ),
          AppSelect<String?>(
            label: 'Chapter',
            value: _chapterId,
            items: <String?>[
              null,
              ...data.chapters
                  .where((Chapter chapter) => _subject == null || chapter.subject == _subject)
                  .where((Chapter chapter) => all.any((StudyCard card) => card.chapterId == chapter.id))
                  .map((Chapter chapter) => chapter.id),
            ],
            labelFor: (String? value) => value == null ? 'All chapters' : data.chapterName(value),
            onChanged: (String? value) => setState(() {
              _chapterId = value;
              _revealed = false;
            }),
          ),
          if (openChapter != null && openChapter.formulaNotes.trim().isNotEmpty)
            OutlinedButton.icon(
              onPressed: () => _importFormulaNotes(context, data, openChapter),
              icon: const Icon(Icons.auto_fix_high_outlined, size: 18),
              label: const Text('Make formula cards from chapter notes'),
            ),
          if (rated > 0)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text(
                'This session: ${cardRatings.map((String r) => '${_session[r]} ${cardRatingLabels[r]!.toLowerCase()}').join(' · ')}. '
                'Again cards stay due today, Hard ones return tomorrow, Good and Easy move up the ladder.',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
              ),
            ),
          if (current == null)
            NotebookCard(
              child: EmptyState(
                title: all.isEmpty
                    ? 'This deck is empty'
                    : _subject != null && !all.any(inSubject)
                        ? 'No $_subject cards yet'
                        : 'Nothing due right now',
                message: all.isEmpty
                    ? 'Add the formulas you keep forgetting, or the facts you want to recall cold. '
                        'Cards resurface on your revision ladder.'
                    : 'Come back when the next rung is due, or switch “Due only” off to review early.',
                icon: Icons.style_outlined,
                action: ElevatedButton(
                  onPressed: () => openCardEditor(context, ref, data, null, newKind,
                      initialChapterId: _chapterId, initialSubject: _subject),
                  child: const Text('Add a card'),
                ),
              ),
            )
          else ...<Widget>[
            NotebookCard(
              title: data.chapterName(current.chapterId),
              subtitle: '${cardLadderLabel(current, gaps)} · reviewed ${current.reviews} '
                  'time${current.reviews == 1 ? '' : 's'}'
                  '${current.lastRating != null ? ' · last: ${cardRatingLabels[current.lastRating]}' : current.difficulty == null ? '' : ' · ${current.difficulty}'}',
              accent: colors.subjectColor(
                data.chapter(current.chapterId)?.subject ?? 'Physics',
              ),
              trailing: IconButton(
                tooltip: 'Edit card',
                icon: const Icon(Icons.edit_outlined, size: 18),
                onPressed: () => openCardEditor(context, ref, data, current, current.kind),
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
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: <Widget>[
                        for (final String rating in cardRatings)
                          Semantics(
                            label: '${cardRatingLabels[rating]} — next review '
                                '${ratingPreview(current, rating, gaps)}',
                            button: true,
                            excludeSemantics: true,
                            child: OutlinedButton(
                              key: ValueKey<String>('rate-$rating'),
                              onPressed: () => _review(context, ref, data, current, rating),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: <Widget>[
                                  Text(cardRatingLabels[rating]!),
                                  Text(
                                    ratingPreview(current, rating, gaps),
                                    style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                                  ),
                                ],
                              ),
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
                        trailing: Text(cardLadderLabel(card, gaps)),
                        onTap: () => openCardEditor(context, ref, data, card, card.kind),
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
    final StudyCard next = reviewCard(card, rating, gaps: data.settings.revisionGaps);
    try {
      await ref.read(dataControllerProvider.notifier).saveCard(next);
      if (!mounted || !context.mounted) return;
      setState(() {
        _revealed = false;
        _session[rating] = (_session[rating] ?? 0) + 1;
      });
      final String when = next.nextReviewAt!.substring(0, 10);
      showToast(context, when == todayIso() ? 'Back again later today.' : 'Next review on $when.');
    } catch (error) {
      if (mounted && context.mounted) showToast(context, error.toString(), error: true);
    }
  }

  /// Website "Make formula cards from chapter notes": one card per new formula line
  /// (front = text before ":" or "Formula n"), at most 200 at a time.
  Future<void> _importFormulaNotes(BuildContext context, AppData data, Chapter chapter) async {
    final List<String> lines = chapter.formulaNotes
        .split('\n')
        .map((String line) => line.trim())
        .where((String line) => line.isNotEmpty)
        .toList();
    final Set<String> existing = data.studyCards
        .where((StudyCard card) => card.chapterId == chapter.id && card.kind == 'formula')
        .map((StudyCard card) => card.back)
        .toSet();
    final List<String> fresh = lines.where((String line) => !existing.contains(line)).take(200).toList();
    if (fresh.isEmpty) {
      showToast(context, 'Every formula line in this chapter is already a card.');
      return;
    }
    final int base = existing.length;
    final String now = isoNow();
    try {
      for (int index = 0; index < fresh.length; index++) {
        final String line = fresh[index];
        final String head = line.contains(':') ? line.split(':').first.trim() : '';
        await ref.read(dataControllerProvider.notifier).saveCard(StudyCard(
              id: newId(),
              userId: data.userId,
              chapterId: chapter.id,
              kind: 'formula',
              front: line.contains(':')
                  ? (head.isEmpty ? _cap(line, 4900) : _cap(head, 4900))
                  : 'Formula ${base + index + 1}',
              back: _cap(line, 9900),
              hint: '',
              position: base + index,
              reviews: 0,
              createdAt: now,
              updatedAt: now,
            ));
      }
      if (context.mounted) {
        showToast(context, '${fresh.length} formula card${fresh.length == 1 ? '' : 's'} created from your notes.');
      }
    } catch (error) {
      if (context.mounted) showToast(context, error.toString(), error: true);
    }
  }
}

String _cap(String value, int max) => value.length <= max ? value : value.substring(0, max);

Future<void> openCardEditor(
  BuildContext context,
  WidgetRef ref,
  AppData data,
  StudyCard? card,
  String kind, {
  String? initialChapterId,
  String? initialSubject,
}) async {
  if (data.chapters.isEmpty) {
    showToast(context, 'Add a chapter in the syllabus first.', error: true);
    return;
  }
  final bool creating = card == null;
  final TextEditingController front = TextEditingController(text: card?.front ?? '');
  final TextEditingController back = TextEditingController(text: card?.back ?? '');
  final TextEditingController hint = TextEditingController(text: card?.hint ?? '');
  Chapter? firstIn(String? subject) => data.chapters.where((Chapter chapter) => chapter.subject == subject).firstOrNull;
  final Chapter startChapter =
      data.chapter(card?.chapterId ?? initialChapterId) ?? firstIn(initialSubject) ?? data.chapters.first;
  String subject = startChapter.subject;
  String? chapterId = startChapter.id;
  final List<String> subjects =
      data.subjects.where((String name) => data.chapters.any((Chapter chapter) => chapter.subject == name)).toList();
  String cardKind = card?.kind ?? kind;

  await showAppSheet<void>(
    context,
    title: creating ? 'New card' : 'Edit card',
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
            label: 'Subject',
            value: subject,
            items: subjects,
            labelFor: (String value) => value,
            onChanged: (String? value) => setSheetState(() {
              if (value == null || value == subject) return;
              subject = value;
              // A chapter from the old subject would file the card in the wrong place.
              chapterId = null;
            }),
          ),
          AppSelect<String?>(
            label: 'Chapter',
            value: chapterId,
            items: <String?>[
              null,
              for (final Chapter chapter in data.chapters)
                if (chapter.subject == subject) chapter.id,
            ],
            labelFor: (String? id) => id == null ? 'Choose a chapter' : data.chapterName(id),
            onChanged: (String? value) => setSheetState(() => chapterId = value),
          ),
          AppField(
            label: cardKind == 'formula' ? 'Formula name or prompt' : 'Question',
            controller: front,
            required: true,
            maxLines: 2,
            maxLength: 5000,
            hint: cardKind == 'formula'
                ? 'e.g. Capacitance of parallel plates'
                : 'e.g. Why does a conductor have zero field inside?',
          ),
          AppField(
            label: cardKind == 'formula' ? 'Formula' : 'Answer',
            controller: back,
            required: true,
            maxLines: 3,
            maxLength: 10000,
            hint: cardKind == 'formula' ? 'C = ε₀A / d' : 'Charges redistribute so the field cancels inside.',
          ),
          AppField(label: 'Hint (optional)', controller: hint, maxLength: 2000),
          ElevatedButton(
            onPressed: () async {
              final Chapter? chosen = data.chapter(chapterId);
              if (chosen == null || chosen.subject != subject) {
                showToast(context, 'Choose a chapter from the selected subject.', error: true);
                return;
              }
              if (front.text.trim().isEmpty || back.text.trim().isEmpty) {
                showToast(context, 'Both the front and the answer are needed.', error: true);
                return;
              }
              final StudyCard next = StudyCard(
                id: card?.id ?? newId(),
                userId: data.userId,
                chapterId: chosen.id,
                kind: cardKind,
                front: front.text.trim(),
                back: back.text.trim(),
                hint: hint.text.trim(),
                position: card != null && card.chapterId == chosen.id
                    ? card.position
                    : data.studyCards.where((StudyCard row) => row.chapterId == chosen.id).length,
                difficulty: card?.difficulty,
                lastRating: card?.lastRating,
                reviews: card?.reviews ?? 0,
                lastReviewedAt: card?.lastReviewedAt,
                nextReviewAt: card?.nextReviewAt,
                createdAt: card?.createdAt ?? isoNow(),
                updatedAt: isoNow(),
              );
              try {
                await ref.read(dataControllerProvider.notifier).saveCard(next);
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, 'Card saved.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: Text(creating ? 'Add card' : 'Save card'),
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
                  await ref.read(dataControllerProvider.notifier).deleteCard(card);
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
