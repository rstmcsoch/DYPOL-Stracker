import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/onboarding.dart';

void main() {
  final AppSettings fresh = AppSettings.defaults('u1', ownerName: 'Asha');

  test('new accounts need setup; finished or exam-chosen accounts do not', () {
    expect(needsOnboarding(fresh), isTrue);
    expect(needsOnboarding(fresh.copyWith(onboardingCompleted: true)), isFalse);
    expect(needsOnboarding(fresh.copyWith(examId: 'neet')), isFalse);
  });

  test('JEE syllabus is seeded only once JEE is really chosen', () {
    expect(shouldSeedJeeSyllabus(fresh), isFalse);
    expect(shouldSeedJeeSyllabus(fresh.copyWith(examId: 'jee')), isTrue);
    expect(shouldSeedJeeSyllabus(fresh.copyWith(onboardingCompleted: true)), isTrue);
    expect(shouldSeedJeeSyllabus(fresh.copyWith(examId: 'neet')), isFalse);
  });

  test('overlay waits for the real cloud settings, then latches', () {
    expect(shouldShowOnboarding(needed: true, loading: true, synced: false, alreadyShown: false), isFalse);
    expect(shouldShowOnboarding(needed: true, loading: false, synced: false, alreadyShown: false), isFalse);
    expect(shouldShowOnboarding(needed: true, loading: false, synced: true, alreadyShown: false), isTrue);
    expect(shouldShowOnboarding(needed: true, loading: true, synced: false, alreadyShown: true), isTrue);
    expect(shouldShowOnboarding(needed: false, loading: false, synced: true, alreadyShown: true), isFalse);
  });

  test('target years: catalogue years sorted, else this year and the next three', () {
    const ExamCatalogEntry withYears = ExamCatalogEntry(id: 'x', name: 'X', category: 'C', years: <int>[2028, 2026]);
    expect(examYears(withYears), <int>[2026, 2028]);
    expect(examYears(fallbackJeeExam, now: DateTime(2026, 10, 25)), <int>[2026, 2027, 2028, 2029]);
  });

  test('subjects follow the stream and the boards add-on', () {
    const ExamCatalogEntry class12 = ExamCatalogEntry(
        id: 'class-12',
        name: 'Class 12',
        category: 'School',
        subjects: <String>['English'],
        sessions: <String>['Commerce']);
    expect(onboardingSubjects(class12, session: 'Commerce'), schoolStreams['Commerce']);
    expect(onboardingSubjects(fallbackJeeExam), <String>['Physics', 'Chemistry', 'Maths']);
    expect(onboardingSubjects(fallbackJeeExam, addon: true), <String>['Physics', 'Chemistry', 'Maths', 'English']);
    const ExamCatalogEntry neet = ExamCatalogEntry(
        id: 'neet',
        name: 'NEET',
        category: 'Medical',
        boardsAddon: true,
        subjects: <String>['Physics', 'Chemistry', 'Botany', 'Zoology']);
    expect(boardAddonSubjects(neet.subjects), <String>['English', 'Physics', 'Chemistry', 'Biology']);
  });

  test('validation matches the website order and wording', () {
    const ExamCatalogEntry ca = ExamCatalogEntry(
        id: 'ca', name: 'CA Inter', category: 'Commerce', sessions: <String>['May'], sessionLabel: 'Attempt');
    String? check(
            {String name = 'Asha',
            ExamCatalogEntry? exam = ca,
            int? year = 2027,
            String? session = 'May',
            bool addon = false,
            String? board,
            String? theme = 'dark'}) =>
        onboardingProblem(
            name: name, exam: exam, year: year, session: session, addon: addon, board: board, theme: theme);
    expect(check(name: '  '), 'Add your name.');
    expect(check(name: 'a' * 81), 'Keep your name under 80 characters.');
    expect(check(exam: null), 'Choose the exam you are preparing for.');
    expect(check(year: null), 'Choose your target year.');
    expect(check(session: null), 'Choose your attempt.');
    expect(check(exam: fallbackJeeExam, addon: true), 'Choose your board.');
    expect(check(theme: null), 'Choose light or dark mode.');
    expect(check(), isNull);
  });

  test('saved settings mirror the website', () {
    final AppSettings saved = onboardingSettings(fresh,
        name: ' Asha K ',
        exam: fallbackJeeExam,
        year: 2027,
        session: 'ignored',
        addon: true,
        board: 'CBSE',
        theme: 'dark');
    expect(saved.ownerName, 'Asha K');
    expect(saved.examId, 'jee');
    expect(saved.examYear, 2027);
    expect(saved.examSession, isNull);
    expect(saved.examBoard, 'CBSE');
    expect(saved.boardsAddon, isTrue);
    expect(saved.theme, 'dark');
    expect(saved.onboardingCompleted, isTrue);
  });
}
