import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';

/// Syllabus, practice, PYQ and chapter-stage maths, ported from
/// src/lib/jee/progress.ts. Every definition matches the website:
///  * Raw completion = chapters Done/Revised ÷ all chapters.
///  * Weighted completion = the same counts scaled by each chapter's importance.
///  * Practice accuracy = correct ÷ attempted for the blocks in view.
///  * A chapter gets a "practice weak" signal only with ≥20 attempted questions.
const int practiceMinAttemptsForSignal = 20;

double importanceWeight(AppSettings settings, String importance) {
  switch (importance) {
    case 'high':
      return settings.weightHigh;
    case 'low':
      return settings.weightLow;
    default:
      return settings.weightMedium;
  }
}

class SubjectProgress {
  const SubjectProgress({
    required this.subject,
    required this.raw,
    required this.weighted,
    required this.completed,
    required this.total,
  });

  final String subject;
  final double? raw;
  final double? weighted;
  final int completed;
  final int total;
}

class SyllabusProgress {
  const SyllabusProgress({
    required this.raw,
    required this.weighted,
    required this.completedChapters,
    required this.totalChapters,
    required this.bySubject,
  });

  final double? raw;
  final double? weighted;
  final int completedChapters;
  final int totalChapters;
  final List<SubjectProgress> bySubject;

  bool get isEmpty => totalChapters == 0;
}

_SyllabusRatio _ratio(List<Chapter> chapters, AppSettings settings) {
  double totalWeight = 0;
  double doneWeight = 0;
  int done = 0;
  for (final Chapter chapter in chapters) {
    final double weight = importanceWeight(settings, chapter.importance);
    totalWeight += weight;
    if (chapter.isComplete) {
      doneWeight += weight;
      done += 1;
    }
  }
  return _SyllabusRatio(
    raw: chapters.isEmpty ? null : done / chapters.length * 100,
    weighted: totalWeight > 0 ? doneWeight / totalWeight * 100 : null,
    completed: done,
    total: chapters.length,
  );
}

SubjectProgress _subjectProgress(String subject, List<Chapter> chapters, AppSettings settings) {
  final _SyllabusRatio ratio = _ratio(chapters, settings);
  return SubjectProgress(
    subject: subject,
    raw: ratio.raw,
    weighted: ratio.weighted,
    completed: ratio.completed,
    total: ratio.total,
  );
}

class _SyllabusRatio {
  const _SyllabusRatio({required this.raw, required this.weighted, required this.completed, required this.total});
  final double? raw;
  final double? weighted;
  final int completed;
  final int total;
}

SyllabusProgress syllabusProgress(AppData data) {
  final _SyllabusRatio overall = _ratio(data.chapters, data.settings);
  return SyllabusProgress(
    raw: overall.raw,
    weighted: overall.weighted,
    completedChapters: overall.completed,
    totalChapters: overall.total,
    bySubject: <SubjectProgress>[
      for (final String subject in data.subjects)
        if (true)
          _subjectProgress(
            subject,
            data.chapters.where((Chapter c) => c.subject == subject).toList(),
            data.settings,
          ),
    ],
  );
}

/* ------------------------------------------------------------------ */
/* Practice                                                            */
/* ------------------------------------------------------------------ */

class PracticeAggregate {
  const PracticeAggregate({
    this.sessions = 0,
    this.attempted = 0,
    this.correct = 0,
    this.incorrect = 0,
    this.skipped = 0,
    this.accuracy,
    this.recentAccuracy,
    this.timeMinutes = 0,
  });

  final int sessions;
  final int attempted;
  final int correct;
  final int incorrect;

  /// Skipped questions; tracked separately and not part of accuracy.
  final int skipped;
  final double? accuracy;
  final double? recentAccuracy;
  final int timeMinutes;
}

PracticeAggregate aggregatePractice(List<PracticeSession> sessions) {
  final List<PracticeSession> sorted = List<PracticeSession>.from(sessions)
    ..sort((PracticeSession a, PracticeSession b) {
      final int byDate = b.practiceDate.compareTo(a.practiceDate);
      return byDate != 0 ? byDate : b.createdAt.compareTo(a.createdAt);
    });
  int attempted = 0;
  int correct = 0;
  int incorrect = 0;
  int skipped = 0;
  int minutes = 0;
  for (final PracticeSession session in sorted) {
    attempted += session.attempted;
    correct += session.correct;
    incorrect += session.incorrect;
    skipped += session.skipped;
    minutes += session.timeMinutes ?? 0;
  }
  final List<PracticeSession> recent = sorted.take(3).toList();
  int recentAttempted = 0;
  int recentCorrect = 0;
  for (final PracticeSession session in recent) {
    recentAttempted += session.attempted;
    recentCorrect += session.correct;
  }
  return PracticeAggregate(
    sessions: sorted.length,
    attempted: attempted,
    correct: correct,
    incorrect: incorrect,
    skipped: skipped,
    accuracy: attempted > 0 ? correct / attempted * 100 : null,
    recentAccuracy: recentAttempted > 0 ? recentCorrect / recentAttempted * 100 : null,
    timeMinutes: minutes,
  );
}

Map<String, PracticeAggregate> practiceByChapter(AppData data) {
  final Map<String, List<PracticeSession>> grouped = <String, List<PracticeSession>>{};
  for (final PracticeSession session in data.practiceSessions) {
    grouped.putIfAbsent(session.chapterId, () => <PracticeSession>[]).add(session);
  }
  return <String, PracticeAggregate>{
    for (final MapEntry<String, List<PracticeSession>> entry in grouped.entries)
      entry.key: aggregatePractice(entry.value),
  };
}

/* ------------------------------------------------------------------ */
/* PYQs                                                                */
/* ------------------------------------------------------------------ */

const Map<String, String> pyqExamLabel = <String, String>{
  'Main': 'JEE Main',
  'Advanced': 'JEE Advanced',
};

/// Inclusive year window from Settings, newest first. Years with no row are pending.
List<int> pyqYears(AppSettings settings) {
  final List<int> years = <int>[];
  for (int year = settings.pyqToYear; year >= settings.pyqFromYear; year -= 1) {
    years.add(year);
  }
  return years;
}

class PyqCompletion {
  const PyqCompletion({
    required this.exam,
    required this.done,
    required this.total,
    required this.percent,
    required this.doneYears,
    required this.pendingYears,
  });

  final String exam;
  final int done;
  final int total;
  final double? percent;
  final List<int> doneYears;
  final List<int> pendingYears;
}

PyqCompletion pyqCompletion(List<PyqRecord> records, String? chapterId, String exam, AppSettings settings) {
  final List<int> years = pyqYears(settings);
  final List<int> doneYears = <int>[];
  for (final int year in years) {
    final bool done = records.any((PyqRecord record) =>
        (chapterId == null || record.chapterId == chapterId) &&
        record.exam == exam &&
        record.year == year &&
        record.status == 'done');
    if (done) doneYears.add(year);
  }
  final int done = doneYears.length;
  return PyqCompletion(
    exam: exam,
    done: done,
    total: years.length,
    percent: years.isEmpty ? null : done / years.length * 100,
    doneYears: doneYears,
    pendingYears: years.where((int year) => !doneYears.contains(year)).toList(),
  );
}

/* ------------------------------------------------------------------ */
/* Chapter stages                                                      */
/* ------------------------------------------------------------------ */

class StageState {
  const StageState({
    required this.key,
    required this.label,
    required this.progress,
    required this.done,
    required this.source,
  });

  final String key;
  final String label;
  final double progress;
  final bool done;

  /// Where the completion came from: the student's own claim, real evidence,
  /// partial PYQ coverage, or nothing yet.
  final String source;
}

/// Derives every stage for one chapter. Manual toggles are the student's own claim;
/// Revised and Tested also accept real evidence (a completed revision, a recorded
/// test result). Nothing forces a linear order.
List<StageState> chapterStages(AppData data, Chapter chapter) {
  final Map<String, bool> manual = <String, bool>{
    for (final ChapterStageRow row in data.chapterStages)
      if (row.chapterId == chapter.id) row.stage: row.done,
  };
  final PyqCompletion main = pyqCompletion(data.pyqRecords, chapter.id, 'Main', data.settings);
  final PyqCompletion advanced = pyqCompletion(data.pyqRecords, chapter.id, 'Advanced', data.settings);
  final int pyqTotal = main.total + advanced.total;
  final int pyqDone = main.done + advanced.done;
  final bool hasRevision = data.revisions
      .any((Revision revision) => revision.chapterId == chapter.id && revision.completedAt != null);
  final bool hasTest = data.tests.any((TestRecord test) => test.chapterId == chapter.id) ||
      data.testChapterLinks.any((TestChapterLink link) => link.chapterId == chapter.id);

  return <StageState>[
    for (final String key in chapterStageKeys)
      _stageFor(
        key: key,
        claimed: manual[key] == true,
        pyqTotal: pyqTotal,
        pyqDone: pyqDone,
        hasRevision: hasRevision,
        hasTest: hasTest,
      ),
  ];
}

StageState _stageFor({
  required String key,
  required bool claimed,
  required int pyqTotal,
  required int pyqDone,
  required bool hasRevision,
  required bool hasTest,
}) {
  final String label = chapterStageLabels[key] ?? key;
  switch (key) {
    case 'pyqs':
      final double progress = pyqTotal > 0 ? pyqDone / pyqTotal : 0;
      final bool done = pyqTotal > 0 && pyqDone == pyqTotal;
      return StageState(
        key: key,
        label: label,
        progress: progress,
        done: done,
        source: done ? 'manual' : (pyqDone > 0 ? 'partial' : 'none'),
      );
    case 'revised':
      final bool done = claimed || hasRevision;
      return StageState(
        key: key,
        label: label,
        progress: done ? 1 : 0,
        done: done,
        source: claimed ? 'manual' : (hasRevision ? 'evidence' : 'none'),
      );
    case 'tested':
      final bool done = claimed || hasTest;
      return StageState(
        key: key,
        label: label,
        progress: done ? 1 : 0,
        done: done,
        source: claimed ? 'manual' : (hasTest ? 'evidence' : 'none'),
      );
    default:
      return StageState(
        key: key,
        label: label,
        progress: claimed ? 1 : 0,
        done: claimed,
        source: claimed ? 'manual' : 'none',
      );
  }
}

/// Average of the five stage progress values: a raw "how far through the pipeline".
double chapterPipelinePercent(List<StageState> stages) {
  if (stages.isEmpty) return 0;
  double sum = 0;
  for (final StageState stage in stages) {
    sum += stage.progress;
  }
  return sum / stages.length * 100;
}

Map<String, int> stageCounts(AppData data) {
  final Map<String, int> counts = <String, int>{for (final String key in chapterStageKeys) key: 0};
  for (final Chapter chapter in data.chapters) {
    for (final StageState stage in chapterStages(data, chapter)) {
      if (stage.done) counts[stage.key] = (counts[stage.key] ?? 0) + 1;
    }
  }
  return counts;
}

/// Study cycle label used on the dashboard: Learn → Test → Analyse → Revise → Repeat.
const List<String> studyCycle = <String>['Learn', 'Test', 'Analyse', 'Revise', 'Repeat'];

/// Which cycle step the notebook suggests next for one chapter.
String nextCycleStep(List<StageState> stages) {
  for (final String key in <String>['theory', 'notes', 'pyqs', 'tested', 'revised']) {
    StageState? stage;
    for (final StageState candidate in stages) {
      if (candidate.key == key) stage = candidate;
    }
    if (stage != null && !stage.done) {
      switch (key) {
        case 'theory':
          return 'Learn';
        case 'notes':
          return 'Learn';
        case 'pyqs':
          return 'Revise';
        case 'tested':
          return 'Test';
        case 'revised':
          return 'Revise';
      }
    }
  }
  return 'Repeat';
}

/// Revision windows visualised as "R1 · R7 · R30" on chapter rows.
String revisionGapLabel(List<int> gaps) => gaps.map((int gap) => 'R$gap').join(' · ');

/// Today's chapter ordering hint: overdue revisions first, then priority.
int chapterUrgency(AppData data, Chapter chapter, String today) {
  int score = 0;
  for (final Revision revision in data.openRevisions()) {
    if (revision.chapterId != chapter.id) continue;
    if (revision.dueOn == today) score += 4;
    if (daysBetween(today, revision.dueOn) < 0) score += 8;
  }
  switch (chapter.priority) {
    case 'High':
      score += 3;
    case 'Medium':
      score += 1;
  }
  if (!chapter.isComplete) score += 1;
  return score;
}
