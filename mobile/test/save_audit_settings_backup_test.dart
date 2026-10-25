import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stracker/core/date.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/features/planner/planner_page.dart';
import 'package:stracker/features/syllabus/syllabus_page.dart';
import 'package:stracker/logic/backup.dart';

import 'support/app_harness.dart';
import 'support/fake_backend.dart';
import 'support/seed.dart';

/// Checkpoint (d) of the end-to-end audit: revision dates that fail after the chapter is
/// saved are queued and retried, multi-task planner writes are all-or-nothing, and backups
/// from the app or the website restore every table without unique-key failures.
void main() {
  late SchemaSnapshot schema;
  setUpAll(() async {
    schema = SchemaSnapshot.load();
    await loadAppFonts();
  });

  Map<String, dynamic> conflict() => postgrestError('08006', 'connection reset');

  Future<(FakeBackend, DataController)> seeded({void Function(FakeBackend)? extra}) async {
    final FakeBackend backend = FakeBackend()
      ..tables['chapters'] = <Map<String, dynamic>>[
        chapterRow('c1', 'Current Electricity'),
        chapterRow('c2', 'Electrostatics', position: 1),
      ];
    extra?.call(backend);
    final DataController data = await backend.controller();
    data.ladderRetryDelay = Duration.zero;
    await data.load();
    expect(data.state.error, isNull);
    return (backend, data);
  }

  Future<void> wait(WidgetTester tester) async {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await settle(tester, frames: 3);
  }

  Future<void> tapButton(WidgetTester tester, String label) async {
    final Finder button = find
        .ancestor(of: find.text(label), matching: find.byWidgetPredicate((Widget w) => w is ButtonStyleButton))
        .last;
    await Scrollable.ensureVisible(tester.element(button), alignment: 0.5);
    await tester.pump();
    await tester.tap(button);
    await wait(tester);
  }

  group('Done chapter revision dates', () {
    test('a failed ladder is retried, queued on the phone, and finished after the next refresh', () async {
      final (FakeBackend backend, DataController data) = await seeded();
      backend.failures['chapter_revisions'] = conflict();
      final Chapter chapter = data.state.data.chapter('c1')!;
      final Revision rung = Revision(
        id: 'r-new',
        userId: 'u1',
        chapterId: 'c1',
        revisionNumber: 1,
        dueOn: '2026-11-01',
        createdAt: isoNow(),
        updatedAt: isoNow(),
      );
      final bool saved = await data.saveChapterAndLadder(
        chapter.copyWith(status: 'Done', completedOn: '2026-10-25'),
        add: <Revision>[rung],
      );
      expect(saved, isFalse);
      // The chapter is stored; the ladder was tried twice (once automatically) and queued.
      expect(backend.tables['chapters']!.firstWhere((Map<String, dynamic> r) => r['id'] == 'c1')['status'], 'Done');
      expect(backend.writesTo('chapter_revisions'), hasLength(2));
      expect(data.state.followUps.single.chapterId, 'c1');

      // The queue survives an app restart.
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final DataController restarted = DataController(repository: backend.repository, preferences: prefs, userId: 'u1');
      expect(restarted.state.followUps.single.add.single.id, 'r-new');

      // Back online: a successful refresh writes the dates without re-saving the chapter.
      backend.failures.remove('chapter_revisions');
      await data.load();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(backend.tables['chapter_revisions']!.single['id'], 'r-new');
      expect(data.state.followUps, isEmpty);
      expect(prefs.getKeys().where((String k) => k.contains('revision-followups')), isEmpty);
      backend.expectAllWritesFit(schema);
    });

    test('a queued ladder for a deleted chapter is dropped, not written', () async {
      final (FakeBackend backend, DataController data) = await seeded();
      backend.failures['chapter_revisions'] = conflict();
      await data.saveChapterAndLadder(
        data.state.data.chapter('c2')!.copyWith(status: 'Done'),
        add: <Revision>[
          Revision(
            id: 'r2',
            userId: 'u1',
            chapterId: 'c2',
            revisionNumber: 1,
            dueOn: '2026-11-01',
            createdAt: isoNow(),
            updatedAt: isoNow(),
          ),
        ],
      );
      backend.failures.remove('chapter_revisions');
      backend.tables['chapters']!.removeWhere((Map<String, dynamic> r) => r['id'] == 'c2');
      await data.load();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(data.state.followUps, isEmpty);
      expect(backend.tables['chapter_revisions'] ?? const <Map<String, dynamic>>[], isEmpty);
    });

    test('moving a chapter out of Done removes only its open revisions, in one request', () async {
      final (FakeBackend backend, DataController data) = await seeded(
        extra: (FakeBackend b) {
          b.tables['chapters']![0] = <String, dynamic>{...chapterRow('c1', 'Current Electricity'), 'status': 'Done'};
          b.tables['chapter_revisions'] = <Map<String, dynamic>>[
            for (int n = 1; n <= 3; n++)
              <String, dynamic>{
                'id': 'r$n',
                'user_id': 'u1',
                'chapter_id': 'c1',
                'revision_number': n,
                'due_on': '2026-11-0$n',
                'completed_at': n == 1 ? '2026-10-20T10:00:00Z' : null,
                'created_at': '2026-10-01T10:00:00Z',
                'updated_at': '2026-10-01T10:00:00Z',
              },
          ];
        },
      );
      final List<Revision> open = data.state.data.revisions.where((Revision r) => r.completedAt == null).toList();
      final bool saved = await data.saveChapterAndLadder(
        data.state.data.chapter('c1')!.copyWith(status: 'In Progress'),
        remove: open,
      );
      expect(saved, isTrue);
      expect(backend.writesTo('chapter_revisions').where((RecordedRequest r) => r.method == 'DELETE'), hasLength(1));
      expect(backend.tables['chapter_revisions']!.map((Map<String, dynamic> r) => r['id']), <String>['r1']);
    });

    testWidgets('the Syllabus banner retries the queued dates', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(() => seeded()))!;
      backend.failures['chapter_revisions'] = conflict();
      await tester.runAsync(() => data.saveChapterAndLadder(
            data.state.data.chapter('c1')!.copyWith(status: 'Done'),
            add: <Revision>[
              Revision(
                id: 'r9',
                userId: 'u1',
                chapterId: 'c1',
                revisionNumber: 1,
                dueOn: '2026-11-01',
                createdAt: isoNow(),
                updatedAt: isoNow(),
              ),
            ],
          ));
      await pumpSignedIn(tester, const SyllabusPage(), data: data);
      expect(find.text('Revision dates not saved yet'), findsOneWidget);
      expect(find.textContaining('Current Electricity'), findsWidgets);
      backend.failures.remove('chapter_revisions');
      await tapButton(tester, 'Retry');
      expect(find.text('Revision dates saved.'), findsOneWidget);
      expect(find.text('Revision dates not saved yet'), findsNothing);
      expect(backend.tables['chapter_revisions']!.single['id'], 'r9');
      expect(tester.takeException(), isNull);
    });
  });

  group('Planner batch writes', () {
    test('several tasks are saved in one request, or none on failure', () async {
      final (FakeBackend backend, DataController data) = await seeded(
        extra: (FakeBackend b) => b.tables['daily_tasks'] = <Map<String, dynamic>>[
          taskRow('t1', 'A', '2026-10-25'),
          <String, dynamic>{...taskRow('t2', 'B', '2026-10-25'), 'position': 1},
        ],
      );
      final List<DailyTask> swapped = <DailyTask>[
        data.state.data.tasks.firstWhere((DailyTask t) => t.id == 't1').copyWith(position: 1),
        data.state.data.tasks.firstWhere((DailyTask t) => t.id == 't2').copyWith(position: 0),
      ];
      backend.failures['daily_tasks'] = conflict();
      await expectLater(data.saveTasks(swapped), throwsA(anything));
      expect(data.state.data.tasksOn('2026-10-25').map((DailyTask t) => t.id), <String>['t1', 't2']);
      backend.failures.remove('daily_tasks');
      await data.saveTasks(swapped);
      expect(backend.writesTo('daily_tasks'), hasLength(2), reason: 'one request per attempt');
      expect(data.state.data.tasksOn('2026-10-25').map((DailyTask t) => t.id), <String>['t2', 't1']);
      backend.expectAllWritesFit(schema);
    });

    testWidgets('copying the previous day writes every task in one request', (WidgetTester tester) async {
      final String yesterday = addDays(todayIso(), -1);
      final (FakeBackend backend, DataController data) = (await tester.runAsync(() => seeded(
            extra: (FakeBackend b) => b.tables['daily_tasks'] = <Map<String, dynamic>>[
              for (int i = 0; i < 3; i++) <String, dynamic>{...taskRow('y$i', 'Task $i', yesterday), 'position': i},
            ],
          )))!;
      await pumpSignedIn(tester, const PlannerPage(), data: data);
      await tapButton(tester, 'Copy the previous day’s plan here');
      await tapButton(tester, 'Copy');
      expect(find.text('Copied 3 tasks.'), findsOneWidget);
      expect(backend.writesTo('daily_tasks'), hasLength(1));
      expect(backend.rowsSentTo('daily_tasks').map((Map<String, dynamic> r) => r['position']), <int>[0, 1, 2]);
      expect(data.state.data.tasksOn(todayIso()), hasLength(3));
      backend.expectAllWritesFit(schema);
      expect(tester.takeException(), isNull);
    });
  });

  group('Backup import', () {
    test('a website backup (camelCase keys, extra fields) restores every table', () async {
      // This account was re-seeded: same chapter name under a new id, and an R1 already.
      final (FakeBackend backend, DataController data) = await seeded(
        extra: (FakeBackend b) => b.tables['chapter_revisions'] = <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'local-r1',
            'user_id': 'u1',
            'chapter_id': 'c1',
            'revision_number': 1,
            'due_on': '2026-11-01',
            'created_at': '2026-10-01T10:00:00Z',
            'updated_at': '2026-10-01T10:00:00Z',
          },
        ],
      );
      final Map<String, dynamic> website = <String, dynamic>{
        'version': 2,
        'settings': <String, dynamic>{'id': 'other', 'user_id': 'other', 'owner_name': 'Rustam'},
        'profile': <String, dynamic>{'id': 'other', 'user_id': 'other', 'display_name': 'Rustam', 'email': 'x@y.z'},
        'chapters': <Map<String, dynamic>>[
          <String, dynamic>{...chapterRow('old-c1', 'Current Electricity'), 'user_id': 'other', 'status': 'Done'},
        ],
        'revisions': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'old-r1',
            'user_id': 'other',
            'chapter_id': 'old-c1',
            'revision_number': 1,
            'due_on': '2026-10-28',
            'created_at': '2026-10-01T10:00:00Z',
            'updated_at': '2026-10-01T10:00:00Z',
          },
        ],
        'tasks': <Map<String, dynamic>>[
          <String, dynamic>{...taskRow('old-t1', 'Kirchhoff set', '2026-10-20'), 'chapter_id': 'old-c1'},
        ],
        'mistakes': <Map<String, dynamic>>[
          <String, dynamic>{
            ...mistakeRow('old-m1', 'old-c1', 'Sign of EMF'),
            'image_data': 'data:image/webp;base64,AAAA',
            'image_preview': 'data:image/webp;base64,AAAA',
            'image_pending': false,
          },
        ],
      };
      expect(backupCounts(website), containsPair('chapter_revisions', 1));
      expect(backupCounts(website), containsPair('daily_tasks', 1));

      final int written = await data.importBackup(website);
      expect(written, 6);
      // No duplicate chapter: the backup row merged into the existing one, and children follow.
      expect(backend.tables['chapters']!.where((Map<String, dynamic> r) => r['name'] == 'Current Electricity'),
          hasLength(1));
      expect(data.state.data.chapter('c1')!.status, 'Done');
      expect(backend.tables['chapter_revisions']!.single['id'], 'local-r1');
      expect(backend.tables['chapter_revisions']!.single['due_on'], '2026-10-28');
      expect(backend.tables['daily_tasks']!.single['chapter_id'], 'c1');
      expect(backend.tables['mistakes']!.single['chapter_id'], 'c1');
      expect(backend.tables['app_settings']!.single['id'], 'u1');
      expect(backend.tables['profiles']!.single['user_id'], 'u1');
      for (final String table in backend.tables.keys) {
        for (final Map<String, dynamic> row in backend.tables[table]!) {
          expect(row['user_id'], 'u1', reason: '$table rows belong to the signed-in account');
        }
      }
      backend.expectAllWritesFit(schema);

      // Importing the same file again is safe.
      await data.importBackup(website);
      expect(backend.tables['chapter_revisions'], hasLength(1));
      expect(data.state.error, isNull);
    });

    test("the app's own backup round-trips into an empty account", () async {
      final (FakeBackend _, DataController source) = await seeded(
        extra: (FakeBackend b) => b
          ..tables['daily_tasks'] = <Map<String, dynamic>>[taskRow('t1', 'A', '2026-10-25')]
          ..tables['mistakes'] = <Map<String, dynamic>>[mistakeRow('m1', 'c1', 'Q')],
      );
      final Map<String, dynamic> payload = buildBackupPayload(source.state.data);
      final FakeBackend empty = FakeBackend();
      final DataController target = await empty.controller();
      await target.load();
      await target.importBackup(payload);
      expect(target.state.data.chapters, hasLength(2));
      expect(target.state.data.tasks, hasLength(1));
      expect(target.state.data.mistakes, hasLength(1));
      expect(empty.tables['app_settings'], hasLength(1));
      empty.expectAllWritesFit(schema);
    });

    test('a failed import says how far it got and that retrying is safe', () async {
      final (FakeBackend backend, DataController data) = await seeded();
      backend.failures['daily_tasks'] = conflict();
      await expectLater(
        data.importBackup(<String, dynamic>{
          'chapters': <Map<String, dynamic>>[chapterRow('n1', 'Optics')],
          'daily_tasks': <Map<String, dynamic>>[taskRow('t1', 'A', '2026-10-25')],
        }),
        throwsA(predicate((Object e) => '$e'.contains('importing the same file again is safe'))),
      );
      expect(data.state.data.chapter('n1'), isNotNull, reason: 'the screen is re-synced after a partial import');
    });
  });
}
