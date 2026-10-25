import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/errors.dart';
import 'package:stracker/core/widgets/fields.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/features/backlog/backlog_page.dart';
import 'package:stracker/features/mistakes/mistakes_page.dart';
import 'package:stracker/features/practice/practice_page.dart';
import 'package:stracker/features/tests/tests_page.dart';
import 'package:stracker/logic/test_form.dart';

import 'support/app_harness.dart';
import 'support/fake_backend.dart';
import 'support/seed.dart';

/// Checkpoint (b) of the end-to-end audit: every save in Tests, Practice, Mistakes, the
/// Retry list and Backlog, driven through the real editors where possible, with each
/// payload checked against the live schema (columns, NOT NULL, CHECKs and UNIQUE keys).
void main() {
  late SchemaSnapshot schema;
  setUpAll(() async {
    schema = SchemaSnapshot.load();
    await loadAppFonts();
  });

  Future<(FakeBackend, DataController)> seeded({void Function(FakeBackend)? extra}) async {
    final FakeBackend backend = FakeBackend()
      ..tables['chapters'] = <Map<String, dynamic>>[
        chapterRow('c1', 'Current Electricity'),
        chapterRow('c2', 'Electrostatics', position: 1),
        chapterRow('c3', 'Mole Concept', subject: 'Chemistry', position: 2),
      ];
    extra?.call(backend);
    final DataController data = await backend.controller();
    await data.load();
    expect(data.state.error, isNull);
    return (backend, data);
  }

  Finder field(String label) =>
      find.descendant(of: find.widgetWithText(AppField, label), matching: find.byType(TextField)).first;

  /// Scrolls [target] to the middle of the screen (clear of the floating action button).
  Future<void> centre(WidgetTester tester, Finder target) async {
    await Scrollable.ensureVisible(tester.element(target), alignment: 0.5);
    await tester.pump();
  }

  Future<void> tapButton(WidgetTester tester, String label) async {
    final Finder button = find
        .ancestor(of: find.text(label), matching: find.byWidgetPredicate((Widget w) => w is ButtonStyleButton))
        .last;
    await centre(tester, button);
    await tester.tap(button);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await settle(tester, frames: 3);
  }

  group('Tests', () {
    testWidgets('logging a chapter test from the editor writes a valid test and chapter link',
        (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      await pumpSignedIn(tester, const TestsPage(), data: data);
      await tester.tap(find.text('Log a test').first);
      await settle(tester, frames: 3);
      await tester.enterText(field('Test title'), 'Allen minor 7');
      await tester.enterText(field('Marks obtained'), '45.5');
      await tester.enterText(field('Total marks'), '60');
      await tester.enterText(field('Total questions (optional)'), '20');
      await tester.enterText(field('Correct'), '12');
      await tester.enterText(field('Wrong'), '5');
      await tester.enterText(field('Skipped'), '3');
      await tapButton(tester, 'Save test');
      expect(tester.takeException(), isNull);
      final Map<String, dynamic> row = backend.rowsSentTo('tests').single;
      expect(row['marks_obtained'], 45.5);
      expect(row['total_marks'], 60);
      backend.expectAllWritesFit(schema);
      expect(data.state.data.tests.single.title, 'Allen minor 7');
      expect(data.state.error, isNull);
    });

    testWidgets('the editor blocks marks above the total and counts above the questions, sending nothing',
        (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      await pumpSignedIn(tester, const TestsPage(), data: data);
      await tester.tap(find.text('Log a test').first);
      await settle(tester, frames: 3);
      await tester.enterText(field('Test title'), 'Over the top');
      await tester.enterText(field('Marks obtained'), '70');
      await tester.enterText(field('Total marks'), '60');
      await tapButton(tester, 'Save test');
      expect(find.text('Marks obtained cannot exceed total marks.'), findsOneWidget);
      await tester.enterText(field('Marks obtained'), '40.3');
      await tapButton(tester, 'Save test');
      await tester.enterText(field('Marks obtained'), '40');
      await tester.enterText(field('Total questions (optional)'), '10');
      await tester.enterText(field('Correct'), '8');
      await tester.enterText(field('Wrong'), '5');
      await tapButton(tester, 'Save test');
      expect(backend.writesTo('tests'), isEmpty);
      expect(tester.takeException(), isNull);
    });

    testWidgets('editing an existing test keeps its id and chapter link', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(() => seeded(
            extra: (FakeBackend b) => b
              ..tables['tests'] = <Map<String, dynamic>>[
                <String, dynamic>{...testRow('t1', 'Weekly 3'), 'chapter_id': 'c1'},
              ]
              ..tables['test_chapter_links'] = <Map<String, dynamic>>[
                <String, dynamic>{
                  'id': 'l1',
                  'user_id': 'u1',
                  'test_id': 't1',
                  'chapter_id': 'c1',
                  'marks_obtained': 40,
                  'total_marks': 60,
                  'created_at': '2026-10-12T10:00:00Z',
                  'updated_at': '2026-10-12T10:00:00Z',
                },
              ],
          )))!;
      await pumpSignedIn(tester, const TestsPage(), data: data);
      await tester.tap(find.text('Weekly 3').first);
      await settle(tester, frames: 3);
      final TextField total = tester.widget<TextField>(field('Total marks'));
      expect(total.controller!.text, '60', reason: 'a whole total must prefill as "60", not "60.00"');
      await tester.enterText(field('Test title'), 'Weekly 3 (rechecked)');
      await tester.enterText(field('Marks obtained'), '42');
      await tapButton(tester, 'Save changes');
      expect(backend.rowsSentTo('tests').single['id'], 't1');
      expect(backend.tables['test_chapter_links']!.single['id'], 'l1');
      expect(backend.tables['test_chapter_links']!.single['marks_obtained'], 42);
      backend.expectAllWritesFit(schema);
      expect(tester.takeException(), isNull);
    });

    test('editing a Full Mock reuses each subject row, so the unique (test, subject) key never clashes', () async {
      final (FakeBackend backend, DataController data) = await seeded();
      TestSaveResult build(Map<String, ({String marks, String total})> scores) => buildTestSave(
            input: TestFormInput(title: 'AITS 3', date: '2026-10-20', type: 'Full Mock', mockScores: scores),
            testId: 't9',
            userId: 'u1',
            chapters: data.state.data.chapters,
            existingScores: data.state.data.testSubjectScores.where((TestSubjectScore s) => s.testId == 't9').toList(),
            existingLinks: const <TestChapterLink>[],
            existing: data.state.data.tests.where((TestRecord t) => t.id == 't9').firstOrNull,
            now: '2026-10-20T10:00:00Z',
          );
      final TestSaveResult first = build(<String, ({String marks, String total})>{
        'Physics': (marks: '50', total: '100'),
        'Chemistry': (marks: '61.5', total: '100'),
        'Mathematics': (marks: '40', total: '100'),
      });
      await data.saveTest(first.test!, subjectScores: first.scores);
      final TestSaveResult second = build(<String, ({String marks, String total})>{
        'Physics': (marks: '55', total: '100'),
        'Chemistry': (marks: '61.5', total: '100'),
        'Mathematics': (marks: '', total: ''),
      });
      await data.saveTest(second.test!, subjectScores: second.scores);
      expect(data.state.error, isNull);
      expect(backend.tables['test_subject_scores']!.map((Map<String, dynamic> r) => r['subject']),
          unorderedEquals(<String>['Physics', 'Chemistry']));
      expect(data.state.data.testSubjectScores.length, 2);
      backend.expectAllWritesFit(schema);
    });

    test('moving a test to another chapter replaces its link without a duplicate', () async {
      final (FakeBackend backend, DataController data) = await seeded();
      Future<void> save(String chapterId) async {
        final TestSaveResult result = buildTestSave(
          input: TestFormInput(
              title: 'Weekly',
              date: '2026-10-20',
              type: 'Chapter Test',
              chapterId: chapterId,
              marks: '30',
              total: '40'),
          testId: 't5',
          userId: 'u1',
          chapters: data.state.data.chapters,
          existingScores: const <TestSubjectScore>[],
          existingLinks: data.state.data.testChapterLinks.where((TestChapterLink l) => l.testId == 't5').toList(),
          existing: data.state.data.tests.where((TestRecord t) => t.id == 't5').firstOrNull,
          now: '2026-10-20T10:00:00Z',
        );
        expect(result.ok, isTrue, reason: '${result.errors}');
        await data.saveTest(result.test!, chapterLink: result.link, replaceChapterLinks: true);
      }

      await save('c1');
      await save('c1');
      await save('c2');
      expect(backend.tables['test_chapter_links']!.single['chapter_id'], 'c2');
      expect(data.state.data.testChapterLinks.single.chapterId, 'c2');
      backend.expectAllWritesFit(schema);
    });

    test('a test whose subject scores fail is rolled back on screen and re-synced from the cloud', () async {
      final (FakeBackend backend, DataController data) = await seeded();
      backend.failures['test_subject_scores'] = postgrestError('42501', 'permission denied');
      final TestSaveResult result = buildTestSave(
        input: const TestFormInput(
          title: 'AITS 4',
          date: '2026-10-21',
          type: 'Full Mock',
          mockScores: <String, ({String marks, String total})>{'Physics': (marks: '50', total: '100')},
        ),
        testId: 't10',
        userId: 'u1',
        chapters: data.state.data.chapters,
        existingScores: const <TestSubjectScore>[],
        existingLinks: const <TestChapterLink>[],
        now: '2026-10-21T10:00:00Z',
      );
      await expectLater(data.saveTest(result.test!, subjectScores: result.scores), throwsA(isA<AppFailure>()));
      expect(data.state.error, isNot(contains('permission denied')));
      // The test row itself did reach the server before the failure: the re-sync shows it.
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(data.state.data.tests.map((TestRecord t) => t.id), contains('t10'));
      expect(data.state.data.testSubjectScores, isEmpty);
    });

    test('error-log and time-split rows fit the schema', () async {
      final (FakeBackend backend, DataController data) = await seeded(
        extra: (FakeBackend b) => b.tables['tests'] = <Map<String, dynamic>>[testRow('t1', 'Mock 1')],
      );
      await data.saveErrorLog(TestErrorLog(
        id: newId(),
        userId: 'u1',
        testId: 't1',
        category: 'Silly mistake',
        subject: 'Physics',
        chapterId: 'c1',
        questions: 2,
        marksLost: 8,
        note: '',
        createdAt: isoNow(),
        updatedAt: isoNow(),
      ));
      await data.saveTimeEntry(TestTimeEntry(
        id: stableId('t1:time:Physics'),
        userId: 'u1',
        testId: 't1',
        subject: 'Physics',
        label: '',
        minutes: 60,
        attempted: 20,
        unattempted: 5,
        orderIndex: 0,
        createdAt: isoNow(),
        updatedAt: isoNow(),
      ));
      backend.expectAllWritesFit(schema);
      expect(data.state.error, isNull);
    });
  });

  group('Practice', () {
    testWidgets('logging practice writes a valid row; minutes over a day are blocked', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      await pumpSignedIn(tester, const PracticePage(), data: data);
      await tester.tap(find.text('Log practice').first);
      await settle(tester, frames: 3);
      await tester.enterText(field('Attempted'), '25');
      await tester.enterText(field('Correct'), '19');
      await tester.enterText(field('Skipped (optional)'), '2');
      await tester.enterText(field('Minutes (optional)'), '2000');
      await tapButton(tester, 'Log practice');
      expect(backend.writesTo('practice_sessions'), isEmpty, reason: '2000 minutes would break the 1440 check');
      await tester.enterText(field('Minutes (optional)'), '45');
      await tapButton(tester, 'Log practice');
      final Map<String, dynamic> row = backend.rowsSentTo('practice_sessions').single;
      expect(row['incorrect'], 6);
      expect(row['time_minutes'], 45);
      backend.expectAllWritesFit(schema);
      expect(find.text('Practice logged.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a double tap on Log practice saves once', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      await pumpSignedIn(tester, const PracticePage(), data: data);
      await tester.tap(find.text('Log practice').first);
      await settle(tester, frames: 3);
      await tester.enterText(field('Attempted'), '10');
      await tester.enterText(field('Correct'), '7');
      final Finder save = find.widgetWithText(ElevatedButton, 'Log practice').last;
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pump();
      await tester.tap(save, warnIfMissed: false);
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
      await settle(tester, frames: 3);
      expect(backend.rowsSentTo('practice_sessions').length, 1);
      expect(data.state.data.practiceSessions.length, 1);
    });
  });

  group('Mistakes', () {
    testWidgets('adding a mistake from the editor writes a valid row', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      await pumpSignedIn(tester, const MistakesPage(), data: data);
      await tester.tap(find.text('Add a mistake').first);
      await settle(tester, frames: 3);
      Future<void> choose(String current, String option) async {
        await tester.tap(find.text(current).last);
        await settle(tester, frames: 3);
        await tester.tap(find.text(option).last);
        await settle(tester, frames: 3);
      }

      await choose('Choose a subject', 'Physics');
      await choose('Choose a chapter', 'Electrostatics');
      await tester.enterText(field('What was the question or mistake?'), 'Took the wrong loop direction');
      await tester.enterText(field('Solution / what I’ll remember'), 'Fix the loop direction first.');
      await tapButton(tester, 'Add to notebook');
      final Map<String, dynamic> row = backend.rowsSentTo('mistakes').single;
      expect(row['retry_status'], 'pending');
      expect(row['chapter_id'], 'c2');
      backend.expectAllWritesFit(schema);
      expect(find.text('Saved to your mistake notebook.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    test('deleting a mistake whose image cleanup fails keeps it deleted', () async {
      final (FakeBackend backend, DataController data) = await seeded(
        extra: (FakeBackend b) => b.tables['mistakes'] = <Map<String, dynamic>>[
          <String, dynamic>{...mistakeRow('m1', 'c1', 'Sign slip'), 'image_path': 'u1/m1.webp'},
        ],
      );
      backend.failures['mistake-images'] = postgrestError('500', 'storage down');
      await data.deleteMistake(data.state.data.mistakes.single);
      expect(data.state.data.mistakes, isEmpty);
      expect(data.state.error, isNull);
    });
  });

  group('Backlog', () {
    testWidgets('add, clear, reopen and snooze all write valid rows', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      await pumpSignedIn(tester, const BacklogPage(), data: data);
      await tester.tap(find.text('Add item').first);
      await settle(tester, frames: 3);
      await tester.enterText(field('What is it?'), 'Lecture 8 EMI');
      await tapButton(tester, 'Add to backlog');
      expect(data.state.data.backlogItems.single.title, 'Lecture 8 EMI');
      await tapButton(tester, 'Clear');
      expect(data.state.data.backlogItems.single.status, 'done');
      expect(data.state.data.backlogItems.single.completedAt, isNotNull);
      await tester.tap(find.text('Show'));
      await settle(tester, frames: 2);
      await tapButton(tester, 'Reopen');
      expect(data.state.data.backlogItems.single.status, 'active');
      expect(data.state.data.backlogItems.single.completedAt, isNull);
      await tapButton(tester, 'Snooze until tomorrow');
      expect(data.state.data.backlogItems.single.status, 'snoozed');
      expect(backend.rowsSentTo('backlog_items').length, 4);
      backend.expectAllWritesFit(schema);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an offline add is saved on the phone at once and synced later', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      await pumpSignedIn(tester, const BacklogPage(), data: data);
      await tester.tap(find.text('Add item').first);
      await settle(tester, frames: 3);
      await tester.enterText(field('What is it?'), 'DPP 12 rotation');
      backend.offline = true;
      await tapButton(tester, 'Add to backlog');
      expect(find.textContaining('Check your connection'), findsNothing, reason: 'no failure toast offline');
      expect(find.text('DPP 12 rotation'), findsOneWidget, reason: 'nothing typed is lost');
      expect(data.state.data.backlogItems.single.title, 'DPP 12 rotation', reason: 'kept, not rolled back');
      expect(data.state.pending, 1);
      backend.offline = false;
      await tester.runAsync(() => data.syncNow());
      expect(data.state.pending, 0);
      expect(backend.tables['backlog_items']!.single['title'], 'DPP 12 rotation');
      expect(tester.takeException(), isNull);
    });

    testWidgets('a long cleared list pages in 30 at a time instead of stopping at 60', (WidgetTester tester) async {
      final (_, DataController data) = (await tester.runAsync(() => seeded(
            extra: (FakeBackend b) => b.tables['backlog_items'] = <Map<String, dynamic>>[
              for (int i = 0; i < 75; i += 1) backlogRow('b$i', 'Cleared item $i', status: 'done'),
            ],
          )))!;
      await pumpSignedIn(tester, const BacklogPage(), data: data);
      await tester.tap(find.text('Show'));
      await settle(tester, frames: 2);
      final Finder more = find.byKey(const ValueKey<String>('backlog-show-more-done'));
      expect(find.text('Show 30 more (45 left)'), findsOneWidget);
      await centre(tester, more);
      await tester.tap(more);
      await settle(tester, frames: 2);
      expect(find.text('Show 15 more (15 left)'), findsOneWidget);
      await centre(tester, more);
      await tester.tap(more);
      await settle(tester, frames: 2);
      expect(more, findsNothing, reason: 'all 75 shown');
      expect(tester.takeException(), isNull);
    });
  });
}
