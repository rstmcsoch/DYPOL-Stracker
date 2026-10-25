import '../logic/onboarding.dart' show onboardingSubjects;
import 'models.dart';

/// Everything the notebook needs for one signed-in account, loaded from the same
/// Supabase tables the website uses. Immutable: mutations go through
/// [DataController], which rebuilds this object.
class AppData {
  const AppData({
    required this.userId,
    required this.settings,
    this.profile,
    this.chapters = const <Chapter>[],
    this.revisions = const <Revision>[],
    this.tests = const <TestRecord>[],
    this.testSubjectScores = const <TestSubjectScore>[],
    this.testChapterLinks = const <TestChapterLink>[],
    this.mistakes = const <Mistake>[],
    this.tasks = const <DailyTask>[],
    this.goals = const <WeeklyGoal>[],
    this.sessions = const <StudySession>[],
    this.practiceSessions = const <PracticeSession>[],
    this.pyqRecords = const <PyqRecord>[],
    this.chapterStages = const <ChapterStageRow>[],
    this.backlogItems = const <BacklogItem>[],
    this.studyCards = const <StudyCard>[],
    this.errorLogs = const <TestErrorLog>[],
    this.timeEntries = const <TestTimeEntry>[],
    this.examTracks = const <UserExamTrack>[],
    this.examCatalog = const <ExamCatalogEntry>[],
  });

  final String userId;
  final AppSettings settings;
  final Profile? profile;
  final List<Chapter> chapters;
  final List<Revision> revisions;
  final List<TestRecord> tests;
  final List<TestSubjectScore> testSubjectScores;
  final List<TestChapterLink> testChapterLinks;
  final List<Mistake> mistakes;
  final List<DailyTask> tasks;
  final List<WeeklyGoal> goals;
  final List<StudySession> sessions;
  final List<PracticeSession> practiceSessions;
  final List<PyqRecord> pyqRecords;
  final List<ChapterStageRow> chapterStages;
  final List<BacklogItem> backlogItems;
  final List<StudyCard> studyCards;
  final List<TestErrorLog> errorLogs;
  final List<TestTimeEntry> timeEntries;
  final List<UserExamTrack> examTracks;
  final List<ExamCatalogEntry> examCatalog;

  static AppData empty(String userId) => AppData(
        userId: userId,
        settings: AppSettings.defaults(userId),
      );

  Chapter? chapter(String? id) {
    if (id == null) return null;
    for (final Chapter item in chapters) {
      if (item.id == id) return item;
    }
    return null;
  }

  String chapterName(String? id) => chapter(id)?.name ?? 'Unknown chapter';

  TestRecord? test(String? id) {
    if (id == null) return null;
    for (final TestRecord item in tests) {
      if (item.id == id) return item;
    }
    return null;
  }

  /// Chapters in display order: subject order first, then the saved position.
  List<Chapter> chaptersFor(String subject) {
    final List<Chapter> rows = chapters.where((Chapter c) => c.subject == subject).toList();
    rows.sort((Chapter a, Chapter b) {
      final int byPosition = a.position.compareTo(b.position);
      return byPosition != 0 ? byPosition : a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    return rows;
  }

  /// Every subject that has data, in the exam's configured order first.
  List<String> get subjects {
    final List<String> ordered = <String>[];
    for (final String subject in examSubjectNames(this)) {
      if (!ordered.contains(subject)) ordered.add(subject);
    }
    for (final Chapter chapter in chapters) {
      if (!ordered.contains(chapter.subject)) ordered.add(chapter.subject);
    }
    return ordered;
  }

  List<DailyTask> tasksOn(String date) {
    final List<DailyTask> rows = tasks.where((DailyTask task) => task.taskDate == date).toList();
    rows.sort((DailyTask a, DailyTask b) {
      final int byPosition = a.position.compareTo(b.position);
      return byPosition != 0 ? byPosition : a.createdAt.compareTo(b.createdAt);
    });
    return rows;
  }

  List<Revision> openRevisions() => revisions.where((Revision revision) => revision.completedAt == null).toList();

  List<Mistake> get pendingRetries =>
      mistakes.where((Mistake mistake) => mistake.retryLater && mistake.retryStatus == 'pending').toList();

  List<StudyCard> cardsOf(String kind) => studyCards.where((StudyCard card) => card.kind == kind).toList();

  AppData copyWith({
    AppSettings? settings,
    Object? profile = _keep,
    List<Chapter>? chapters,
    List<Revision>? revisions,
    List<TestRecord>? tests,
    List<TestSubjectScore>? testSubjectScores,
    List<TestChapterLink>? testChapterLinks,
    List<Mistake>? mistakes,
    List<DailyTask>? tasks,
    List<WeeklyGoal>? goals,
    List<StudySession>? sessions,
    List<PracticeSession>? practiceSessions,
    List<PyqRecord>? pyqRecords,
    List<ChapterStageRow>? chapterStages,
    List<BacklogItem>? backlogItems,
    List<StudyCard>? studyCards,
    List<TestErrorLog>? errorLogs,
    List<TestTimeEntry>? timeEntries,
    List<UserExamTrack>? examTracks,
    List<ExamCatalogEntry>? examCatalog,
  }) =>
      AppData(
        userId: userId,
        settings: settings ?? this.settings,
        profile: profile == _keep ? this.profile : profile as Profile?,
        chapters: chapters ?? this.chapters,
        revisions: revisions ?? this.revisions,
        tests: tests ?? this.tests,
        testSubjectScores: testSubjectScores ?? this.testSubjectScores,
        testChapterLinks: testChapterLinks ?? this.testChapterLinks,
        mistakes: mistakes ?? this.mistakes,
        tasks: tasks ?? this.tasks,
        goals: goals ?? this.goals,
        sessions: sessions ?? this.sessions,
        practiceSessions: practiceSessions ?? this.practiceSessions,
        pyqRecords: pyqRecords ?? this.pyqRecords,
        chapterStages: chapterStages ?? this.chapterStages,
        backlogItems: backlogItems ?? this.backlogItems,
        studyCards: studyCards ?? this.studyCards,
        errorLogs: errorLogs ?? this.errorLogs,
        timeEntries: timeEntries ?? this.timeEntries,
        examTracks: examTracks ?? this.examTracks,
        examCatalog: examCatalog ?? this.examCatalog,
      );
}

const Object _keep = Object();

/// The exam's syllabus subjects. JEE (and every notebook created before the exam
/// chooser existed) uses Physics/Chemistry/Maths; other exams use the published
/// catalogue's subject list, exactly like src/lib/exams/subjects.ts.
/// The exam's subjects (website examSubjects): catalog subjects, the class 11/12 stream,
/// and board add-on subjects when the student chose them.
List<String> examSubjectNames(AppData data) {
  final String examId = data.settings.examId ?? 'jee';
  for (final ExamCatalogEntry entry in data.examCatalog) {
    if (entry.id == examId && entry.subjects.isNotEmpty) {
      return onboardingSubjects(entry, session: data.settings.examSession, addon: data.settings.boardsAddon);
    }
  }
  return const <String>['Physics', 'Chemistry', 'Maths'];
}

/// Form subjects: the exam's subjects plus a record's own subject when it is no longer in
/// the list, so editing an old record never silently changes it (useExamSubjects(current)).
List<String> examSubjectsWith(AppData data, String? current) {
  final List<String> list = <String>[...examSubjectNames(data)];
  if (current != null && current.isNotEmpty && !list.contains(current)) list.add(current);
  return list;
}

ExamCatalogEntry? examEntry(AppData data, String? examId) {
  final String id = examId ?? 'jee';
  for (final ExamCatalogEntry entry in data.examCatalog) {
    if (entry.id == id) return entry;
  }
  return null;
}

String examNameFor(AppData data, String? examId) {
  final ExamCatalogEntry? entry = examEntry(data, examId);
  return entry?.name ?? 'JEE (Main + Advanced)';
}

bool isJeeExam(String? examId) => examId == null || examId == 'jee';
