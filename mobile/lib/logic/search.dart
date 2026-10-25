import '../data/app_data.dart';
import '../data/models.dart';

/// What a search result points at. Each kind opens the section that owns it.
enum SearchKind { chapter, test, mistake, task, backlog, card }

/// One search result: the item's id, what to show, and which section opens it.
class SearchHit {
  const SearchHit({
    required this.kind,
    required this.id,
    required this.label,
    required this.context,
    required this.route,
  });

  final SearchKind kind;
  final String id;
  final String label;
  final String context;

  /// The [Routes] key of the section that owns the item.
  final String route;

  String get typeLabel => switch (kind) {
        SearchKind.chapter => 'Chapter',
        SearchKind.test => 'Test',
        SearchKind.mistake => 'Mistake',
        SearchKind.task => 'Task',
        SearchKind.backlog => 'Backlog',
        SearchKind.card => 'Card',
      };
}

/// Searches the whole notebook the way the website's ⌘K search does (chapters with their
/// notes and formula notes, tests with their notes, mistakes, tasks), plus backlog items
/// and formula / flash cards. Every word of the query has to appear; results whose title
/// starts with the query come first within each group.
List<SearchHit> searchNotebook(AppData data, String query, {int perKind = 6, int limit = 36}) {
  final List<String> words =
      query.trim().toLowerCase().split(RegExp(r'\s+')).where((String w) => w.isNotEmpty).toList();
  if (words.isEmpty) return const <SearchHit>[];
  bool matches(String haystack) {
    final String text = haystack.toLowerCase();
    return words.every(text.contains);
  }

  final String first = words.join(' ');
  List<T> pick<T>(Iterable<T> rows, String Function(T) haystack, String Function(T) title) {
    final List<T> found = rows.where((T row) => matches(haystack(row))).toList();
    int rank(T row) => title(row).toLowerCase().startsWith(first) ? 0 : 1;
    // A stable sort keeps the section's own order inside each rank.
    final List<(int, int, T)> ranked = <(int, int, T)>[
      for (int i = 0; i < found.length; i++) (rank(found[i]), i, found[i]),
    ]..sort(((int, int, T) a, (int, int, T) b) => a.$1 != b.$1 ? a.$1.compareTo(b.$1) : a.$2.compareTo(b.$2));
    return ranked.take(perKind).map(((int, int, T) row) => row.$3).toList();
  }

  String oneLine(String text) => text.replaceAll(RegExp(r'\s+'), ' ').trim();

  final List<SearchHit> hits = <SearchHit>[
    for (final Chapter chapter in pick<Chapter>(
      data.chapters,
      (Chapter c) => '${c.name} ${c.subject} ${c.notes} ${c.formulaNotes}',
      (Chapter c) => c.name,
    ))
      SearchHit(
        kind: SearchKind.chapter,
        id: chapter.id,
        label: chapter.name,
        context: '${chapter.subject} · ${chapter.status}',
        route: 'syllabus',
      ),
    for (final TestRecord test in pick<TestRecord>(
      data.tests,
      (TestRecord t) => '${t.title} ${t.testType} ${t.subject ?? ''} ${t.notes}',
      (TestRecord t) => t.title,
    ))
      SearchHit(
        kind: SearchKind.test,
        id: test.id,
        label: test.title,
        context: '${test.testDate} · ${test.testType}',
        route: 'tests',
      ),
    for (final Mistake mistake in pick<Mistake>(
      data.mistakes,
      (Mistake m) => '${m.questionNote} ${m.solutionNote} ${m.mistakeType} ${data.chapter(m.chapterId)?.name ?? ''}',
      (Mistake m) => m.questionNote,
    ))
      SearchHit(
        kind: SearchKind.mistake,
        id: mistake.id,
        label: oneLine(mistake.questionNote),
        context: '${mistake.mistakeType} · ${data.chapterName(mistake.chapterId)}',
        route: 'mistakes',
      ),
    for (final DailyTask task in pick<DailyTask>(
      data.tasks,
      (DailyTask t) => '${t.title} ${t.topic ?? ''} ${t.subject ?? ''}',
      (DailyTask t) => t.title,
    ))
      SearchHit(
        kind: SearchKind.task,
        id: task.id,
        label: task.title,
        context: '${task.taskDate} · ${task.isCompleted ? 'done' : task.priority}',
        route: 'planner',
      ),
    for (final BacklogItem item in pick<BacklogItem>(
      data.backlogItems,
      (BacklogItem b) => '${b.title} ${b.type} ${b.subject ?? ''} ${b.notes}',
      (BacklogItem b) => b.title,
    ))
      SearchHit(
        kind: SearchKind.backlog,
        id: item.id,
        label: item.title,
        context: '${item.type} · ${item.isDone ? 'cleared' : item.status}',
        route: 'backlog',
      ),
    for (final StudyCard card in pick<StudyCard>(
      data.studyCards,
      (StudyCard c) => '${c.front} ${c.back} ${c.hint}',
      (StudyCard c) => c.front,
    ))
      SearchHit(
        kind: SearchKind.card,
        id: card.id,
        label: oneLine(card.front),
        context: '${card.kind == 'formula' ? 'Formula' : 'Flashcard'} · ${data.chapterName(card.chapterId)}',
        route: 'decks',
      ),
  ];
  return hits.take(limit).toList();
}
