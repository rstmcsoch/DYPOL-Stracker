import '../data/app_data.dart';
import '../data/models.dart';

/// First-run setup rules, ported from src/lib/defaults.ts, src/lib/exams/catalog.ts and
/// src/lib/exams/subjects.ts so the app asks exactly what the website asks.

/// Anyone who has not finished setup and has no exam chosen yet.
bool needsOnboarding(AppSettings settings) =>
    !settings.onboardingCompleted && (settings.examId == null || settings.examId!.isEmpty);

/// Seed the JEE syllabus only once JEE is really chosen: an explicit JEE pick, or an account
/// that finished setup before exam choice existed. Brand-new accounts wait for setup.
bool shouldSeedJeeSyllabus(AppSettings settings) =>
    isJeeExam(settings.examId) && (settings.examId != null || settings.onboardingCompleted);

/// Whether the overlay may show. It waits until this account's settings really loaded from
/// the cloud ([synced]), never the empty default or cached copy a fresh start shows, and
/// once shown it stays up until setup is saved ([alreadyShown]).
bool shouldShowOnboarding({
  required bool needed,
  required bool loading,
  required bool synced,
  required bool alreadyShown,
}) {
  if (!needed) return false;
  if (alreadyShown) return true;
  return !loading && synced;
}

const List<String> schoolBoards = <String>['CBSE', 'ICSE / ISC', 'State board', 'Other board'];

const Map<String, List<String>> schoolStreams = <String, List<String>>{
  'Science (PCM)': <String>['English', 'Physics', 'Chemistry', 'Maths'],
  'Science (PCB)': <String>['English', 'Physics', 'Chemistry', 'Biology'],
  'Science (PCMB)': <String>['English', 'Physics', 'Chemistry', 'Maths', 'Biology'],
  'Commerce': <String>['English', 'Accountancy', 'Business Studies', 'Economics', 'Maths'],
  'Humanities': <String>[
    'English',
    'History',
    'Political Science',
    'Geography',
    'Economics',
    'Psychology',
    'Sociology'
  ],
};

const List<String> _pcm = <String>['Physics', 'Chemistry', 'Maths'];
const List<String> _boardScience = <String>['Physics', 'Chemistry', 'Maths', 'Biology'];

/// Used only if the published catalogue could not be read: JEE, the app's long-standing
/// default, so setup can still finish.
const ExamCatalogEntry fallbackJeeExam = ExamCatalogEntry(
  id: 'jee',
  name: 'JEE (Main + Advanced)',
  category: 'Engineering',
  boardsAddon: true,
  subjects: _pcm,
);

/// Target years: the catalogue's own, sorted, or this year and the next three.
List<int> examYears(ExamCatalogEntry exam, {DateTime? now}) {
  if (exam.years.isNotEmpty) return <int>[...exam.years]..sort();
  final int year = (now ?? DateTime.now()).year;
  return <int>[year, year + 1, year + 2, year + 3];
}

List<String> boardAddonSubjects(List<String> examSubjects) {
  final Set<String> has = examSubjects.toSet();
  return <String>[
    'English',
    for (final String subject in _boardScience)
      if (has.contains(subject) || (subject == 'Biology' && (has.contains('Botany') || has.contains('Zoology'))))
        subject,
  ];
}

/// The subjects line under the form, for a not-yet-saved choice.
List<String> onboardingSubjects(ExamCatalogEntry exam, {String? session, bool addon = false}) {
  List<String> base = exam.subjects.isNotEmpty ? <String>[...exam.subjects] : <String>[..._pcm];
  final List<String>? stream = session == null || session.isEmpty ? null : schoolStreams[session];
  if (stream != null && (exam.id == 'class-11' || exam.id == 'class-12')) base = <String>[...stream];
  if (addon && exam.boardsAddon) base = <String>[...base, ...boardAddonSubjects(base)];
  return base.toSet().toList();
}

/// Catalogue grouped by category, keeping the first-seen category order.
List<MapEntry<String, List<ExamCatalogEntry>>> groupByCategory(List<ExamCatalogEntry> exams) {
  final Map<String, List<ExamCatalogEntry>> groups = <String, List<ExamCatalogEntry>>{};
  for (final ExamCatalogEntry exam in exams) {
    (groups[exam.category] ??= <ExamCatalogEntry>[]).add(exam);
  }
  return groups.entries.toList();
}

bool onboardingNeedsBoard(ExamCatalogEntry? exam, bool addon) =>
    exam != null && (exam.boards.isNotEmpty || (exam.boardsAddon && addon));

/// The website's checks, in the same order and wording. Null when the form can be saved.
String? onboardingProblem({
  required String name,
  required ExamCatalogEntry? exam,
  required int? year,
  required String? session,
  required bool addon,
  required String? board,
  required String? theme,
}) {
  final String clean = name.trim();
  if (clean.isEmpty) return 'Add your name.';
  if (clean.length > 80) return 'Keep your name under 80 characters.';
  if (exam == null) return 'Choose the exam you are preparing for.';
  if (year == null) return 'Choose your target year.';
  if (exam.sessions.isNotEmpty && (session == null || session.isEmpty)) {
    final String label = exam.sessionLabel.isEmpty ? 'attempt / session' : exam.sessionLabel;
    return 'Choose your ${label.toLowerCase()}.';
  }
  if (onboardingNeedsBoard(exam, addon) && (board == null || board.isEmpty)) return 'Choose your board.';
  if (theme != 'light' && theme != 'dark') return 'Choose light or dark mode.';
  return null;
}

/// Settings exactly as the website saves them on "Start studying".
AppSettings onboardingSettings(
  AppSettings current, {
  required String name,
  required ExamCatalogEntry exam,
  required int year,
  required String? session,
  required bool addon,
  required String? board,
  required String theme,
}) {
  return current.copyWith(
    ownerName: name.trim(),
    theme: theme,
    examId: exam.id,
    examYear: year,
    examSession: exam.sessions.isNotEmpty ? session : null,
    examBoard: onboardingNeedsBoard(exam, addon) ? board : null,
    boardsAddon: exam.boardsAddon && addon,
    onboardingCompleted: true,
  );
}
