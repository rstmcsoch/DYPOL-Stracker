import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';
import 'analytics.dart';
import 'cards.dart';
import 'exam.dart';
import 'progress.dart';

/// Deterministic "What should I study now?" engine, ported from
/// src/lib/jee/recommend.ts. It only reads data: `today` is injected, so the same
/// data always yields the same ranking, and every result carries its reasons.
class Recommendation {
  const Recommendation({
    required this.id,
    required this.kind,
    required this.title,
    required this.subject,
    required this.chapterId,
    required this.score,
    required this.reasons,
    required this.summary,
    required this.route,
    required this.actionLabel,
  });

  final String id;
  final String kind;
  final String title;
  final String? subject;
  final String? chapterId;
  final double score;
  final List<String> reasons;
  final String summary;

  /// Notebook route the card opens.
  final String route;
  final String actionLabel;
}

class StudyNowResult {
  const StudyNowResult({
    required this.primary,
    required this.alternatives,
    required this.examMode,
    required this.examLabel,
    required this.emptyReason,
  });

  final Recommendation? primary;
  final List<Recommendation> alternatives;
  final bool examMode;
  final String? examLabel;
  final String? emptyReason;
}

String _joinReasons(List<String> reasons) {
  if (reasons.isEmpty) return '';
  if (reasons.length == 1) return reasons.first;
  return '${reasons.sublist(0, reasons.length - 1).join(', ')}, and ${reasons.last}';
}

String _summary(String title, List<String> reasons) =>
    reasons.isEmpty ? 'Study $title.' : 'Study $title — ${_joinReasons(reasons)}.';

class _Draft {
  _Draft({
    required this.id,
    required this.kind,
    required this.title,
    required this.subject,
    required this.chapterId,
    required this.base,
    required this.reasons,
    required this.route,
    required this.actionLabel,
    this.examBoost = false,
    this.scaleByImportance = false,
    this.priority = 'Medium',
  });

  final String id;
  final String kind;
  final String title;
  final String? subject;
  final String? chapterId;
  final double base;
  final List<String> reasons;
  final String route;
  final String actionLabel;
  final bool examBoost;
  final bool scaleByImportance;
  final String priority;
}

StudyNowResult recommendStudyNow(AppData data, String today) {
  final bool examMode = currentExamMode(data, today);
  final Map<String, Chapter> chapterById = <String, Chapter>{
    for (final Chapter chapter in data.chapters) chapter.id: chapter,
  };
  final Map<String, ChapterPerformance> performance = <String, ChapterPerformance>{
    for (final ChapterPerformance item in chapterPerformance(data)) item.chapter.id: item,
  };
  final Map<String, PracticeAggregate> practice = practiceByChapter(data);
  final double weakThreshold = data.settings.weakThreshold;
  final List<_Draft> drafts = <_Draft>[];

  // 1. Revisions — overdue first, then due today.
  final Map<String, ({int overdueDays, bool dueToday, int count})> revisionInfo =
      <String, ({int overdueDays, bool dueToday, int count})>{};
  for (final Revision revision in data.revisions) {
    if (revision.completedAt != null || !chapterById.containsKey(revision.chapterId)) continue;
    final ({int overdueDays, bool dueToday, int count}) current =
        revisionInfo[revision.chapterId] ?? (overdueDays: 0, dueToday: false, count: 0);
    if (daysBetween(today, revision.dueOn) < 0) {
      final int overdue = -daysBetween(today, revision.dueOn);
      revisionInfo[revision.chapterId] = (
        overdueDays: overdue > current.overdueDays ? overdue : current.overdueDays,
        dueToday: current.dueToday,
        count: current.count + 1,
      );
    } else if (revision.dueOn == today) {
      revisionInfo[revision.chapterId] = (
        overdueDays: current.overdueDays,
        dueToday: true,
        count: current.count + 1,
      );
    } else {
      revisionInfo[revision.chapterId] = current;
    }
  }
  for (final MapEntry<String, ({int overdueDays, bool dueToday, int count})> entry
      in revisionInfo.entries) {
    if (entry.value.count == 0) continue;
    final Chapter chapter = chapterById[entry.key]!;
    final List<String> reasons = <String>[];
    final double base;
    if (entry.value.overdueDays > 0) {
      base = 78 + (entry.value.overdueDays > 14 ? 14 : entry.value.overdueDays) * 1.2;
      reasons.add('revision is overdue by ${entry.value.overdueDays} '
          'day${entry.value.overdueDays == 1 ? '' : 's'}');
    } else {
      base = 60;
      reasons.add('revision is due today');
    }
    drafts.add(_Draft(
      id: 'rev:${chapter.id}',
      kind: 'revision',
      title: chapter.name,
      subject: chapter.subject,
      chapterId: chapter.id,
      base: base,
      reasons: reasons,
      route: 'revision',
      actionLabel: 'Open revisions',
      examBoost: true,
      scaleByImportance: true,
      priority: chapter.priority,
    ));
  }

  // 2. Backlog — overdue, due today, or high priority.
  for (final BacklogItem item in data.backlogItems) {
    if (!isBacklogAwake(item, today)) continue;
    final bool overdue = item.dueOn != null && daysBetween(today, item.dueOn!) < 0;
    final bool dueToday = item.dueOn == today;
    if (!overdue && !dueToday && item.priority != 'High') continue;
    if (examMode && !overdue && !dueToday && item.priority != 'High') continue;
    final List<String> reasons = <String>[];
    final double base;
    if (overdue) {
      base = 70;
      reasons.add('it is past its due date');
    } else if (dueToday) {
      base = 60;
      reasons.add('it is due today');
    } else {
      base = 46;
      reasons.add('it is marked high priority');
    }
    if (item.priority == 'High' && !reasons.contains('it is marked high priority')) {
      reasons.add('it is marked high priority');
    }
    final Chapter? chapter = chapterById[item.chapterId];
    drafts.add(_Draft(
      id: 'backlog:${item.id}',
      kind: 'backlog',
      title: item.title,
      subject: item.subject ?? chapter?.subject,
      chapterId: item.chapterId,
      base: base,
      reasons: reasons,
      route: 'backlog',
      actionLabel: 'Open backlog',
      priority: item.priority,
    ));
  }

  // 3. Flashcards due for review, grouped by chapter.
  final Map<String, int> dueByChapter = <String, int>{};
  for (final StudyCard card in data.studyCards) {
    if (!isCardDue(card, today: today) || !chapterById.containsKey(card.chapterId)) continue;
    dueByChapter[card.chapterId] = (dueByChapter[card.chapterId] ?? 0) + 1;
  }
  for (final MapEntry<String, int> entry in dueByChapter.entries) {
    final Chapter chapter = chapterById[entry.key]!;
    drafts.add(_Draft(
      id: 'cards:${chapter.id}',
      kind: 'flashcards',
      title: '${chapter.name} flashcards',
      subject: chapter.subject,
      chapterId: chapter.id,
      base: 50 + (entry.value > 10 ? 10 : entry.value).toDouble(),
      reasons: <String>[
        '${entry.value} card${entry.value == 1 ? ' is' : 's are'} due for review',
      ],
      route: 'decks',
      actionLabel: 'Review cards',
      examBoost: true,
      priority: chapter.priority,
    ));
  }

  // 4. Mistakes waiting for a retry.
  final Map<String, int> retryByChapter = <String, int>{};
  for (final Mistake mistake in data.mistakes) {
    if (mistake.retryStatus != 'pending' || !mistake.retryLater) continue;
    if (!chapterById.containsKey(mistake.chapterId)) continue;
    retryByChapter[mistake.chapterId] = (retryByChapter[mistake.chapterId] ?? 0) + 1;
  }
  for (final MapEntry<String, int> entry in retryByChapter.entries) {
    final Chapter chapter = chapterById[entry.key]!;
    drafts.add(_Draft(
      id: 'retry:${chapter.id}',
      kind: 'retry-mistakes',
      title: 'Retry ${chapter.name} mistakes',
      subject: chapter.subject,
      chapterId: chapter.id,
      base: 55 + (entry.value > 8 ? 8 : entry.value).toDouble(),
      reasons: <String>['${entry.value} mistake${entry.value == 1 ? '' : 's'} awaiting a retry'],
      route: 'retry',
      actionLabel: 'Open retry',
      priority: chapter.priority,
    ));
  }

  // 5. Weak practice chapters (needs a real sample of questions).
  for (final MapEntry<String, PracticeAggregate> entry in practice.entries) {
    final PracticeAggregate value = entry.value;
    final Chapter? chapter = chapterById[entry.key];
    if (chapter == null || value.attempted < practiceMinAttemptsForSignal) continue;
    final double accuracy = value.accuracy ?? 100;
    if (accuracy >= weakThreshold) continue;
    drafts.add(_Draft(
      id: 'practice:${chapter.id}',
      kind: 'practice',
      title: '${chapter.name} practice',
      subject: chapter.subject,
      chapterId: chapter.id,
      base: 62 + (weakThreshold - accuracy) * 0.3,
      reasons: <String>[
        'practice accuracy is ${accuracy.toStringAsFixed(0)}% over ${value.attempted} questions',
      ],
      route: 'practice',
      actionLabel: 'Log practice',
      examBoost: true,
      scaleByImportance: true,
      priority: chapter.priority,
    ));
  }

  // 6. Weak (well-sampled) test chapters.
  for (final ChapterPerformance item in performance.values) {
    if (item.classification != 'Weak') continue;
    drafts.add(_Draft(
      id: 'weak:${item.chapter.id}',
      kind: 'weak-chapter',
      title: item.chapter.name,
      subject: item.chapter.subject,
      chapterId: item.chapter.id,
      base: 74 + (weakThreshold - (item.average ?? 0)) * 0.35,
      reasons: <String>[
        'test average is ${(item.average ?? 0).toStringAsFixed(0)}%',
        if (item.trend == 'down') 'and the latest test dropped',
      ],
      route: 'weak-areas',
      actionLabel: 'Open weak areas',
      examBoost: true,
      scaleByImportance: true,
      priority: item.chapter.priority,
    ));
  }

  // 7. Pending PYQs for chapters already studied.
  for (final Chapter chapter in data.chapters) {
    if (!chapter.isComplete) continue;
    final PyqCompletion pyq = pyqCompletion(data.pyqRecords, chapter.id, 'Main', data.settings);
    if (pyq.pendingYears.isEmpty) continue;
    drafts.add(_Draft(
      id: 'pyq:${chapter.id}',
      kind: 'pyq',
      title: '${chapter.name} PYQs',
      subject: chapter.subject,
      chapterId: chapter.id,
      base: 44 + (pyq.pendingYears.length > 4 ? 4 : pyq.pendingYears.length).toDouble(),
      reasons: <String>[
        '${pyq.pendingYears.length} PYQ year${pyq.pendingYears.length == 1 ? '' : 's'} still pending',
      ],
      route: 'pyqs',
      actionLabel: 'Open PYQs',
      examBoost: true,
      priority: chapter.priority,
    ));
  }

  // 8. Start a chapter that has no evidence at all.
  if (drafts.isEmpty) {
    for (final Chapter chapter in data.chapters) {
      if (chapter.isComplete) continue;
      final bool hasEvidence = practice.containsKey(chapter.id) ||
          data.tests.any((TestRecord test) => test.chapterId == chapter.id);
      if (hasEvidence) continue;
      drafts.add(_Draft(
        id: 'start:${chapter.id}',
        kind: 'start-chapter',
        title: chapter.name,
        subject: chapter.subject,
        chapterId: chapter.id,
        base: 30,
        reasons: <String>['nothing recorded for this chapter yet'],
        route: 'syllabus',
        actionLabel: 'Open chapter',
        priority: chapter.priority,
      ));
      if (drafts.length >= 6) break;
    }
  }

  final List<Recommendation> scored = <Recommendation>[];
  for (final _Draft draft in drafts) {
    double score = draft.base;
    if (draft.scaleByImportance && draft.chapterId != null) {
      final Chapter? chapter = chapterById[draft.chapterId];
      final double weight = importanceWeight(data.settings, chapter?.importance ?? 'medium');
      final double medium = data.settings.weightMedium;
      if (medium > 0) {
        final double factor = (weight / medium).clamp(0.6, 1.6);
        score *= factor;
      }
    }
    if (examMode && draft.examBoost) score *= examModeBoost;
    switch (draft.priority) {
      case 'High':
        score += 4;
      case 'Medium':
        score += 1.5;
      default:
        score += 0;
    }
    scored.add(Recommendation(
      id: draft.id,
      kind: draft.kind,
      title: draft.title,
      subject: draft.subject,
      chapterId: draft.chapterId,
      score: score,
      reasons: draft.reasons,
      summary: _summary(draft.title, draft.reasons),
      route: draft.route,
      actionLabel: draft.actionLabel,
    ));
  }
  scored.sort((Recommendation a, Recommendation b) {
    final int byScore = b.score.compareTo(a.score);
    return byScore != 0 ? byScore : a.title.compareTo(b.title);
  });

  final String? emptyReason = scored.isEmpty
      ? (data.tests.any((TestRecord test) => test.testDate == today)
          ? 'Today\u2019s test is logged and nothing else is urgent right now. Review it, or log a practice block.'
          : 'Nothing is due and no chapter needs attention yet. Log a test, a practice block or a '
              'revision and the ranking appears here.')
      : null;

  return StudyNowResult(
    primary: scored.isEmpty ? null : scored.first,
    alternatives: scored.length > 1 ? scored.sublist(1, scored.length > 5 ? 5 : scored.length) : const <Recommendation>[],
    examMode: examMode,
    examLabel: examMode ? examModeLabel(data, today) : null,
    emptyReason: emptyReason,
  );
}

/// Backlog items are "awake" unless snoozed into the future.
bool isBacklogAwake(BacklogItem item, String today) {
  if (item.status != 'active') return false;
  final String? snoozed = item.snoozedUntil;
  if (snoozed == null || snoozed.isEmpty) return true;
  return snoozed.compareTo(today) <= 0;
}
