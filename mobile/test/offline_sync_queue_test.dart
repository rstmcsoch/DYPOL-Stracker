import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/data/sync_queue.dart';

import 'support/fake_backend.dart';
import 'support/seed.dart';

/// Offline-first saving: changes made without a connection are kept on the phone at once
/// (no failure, no rollback), queued on disk, and sent in order when the connection is
/// back; deletes travel as tombstones so a reload never brings a deleted row back.
void main() {
  Future<(FakeBackend, DataController)> seeded() async {
    final FakeBackend backend = FakeBackend()
      ..tables['chapters'] = <Map<String, dynamic>>[
        chapterRow('c1', 'Current Electricity'),
        chapterRow('c2', 'Optics', position: 1),
      ]
      ..tables['tests'] = <Map<String, dynamic>>[testRow('t1', 'Mock 1')]
      ..tables['daily_tasks'] = <Map<String, dynamic>>[taskRow('d1', 'Revise loops', '2026-10-25')]
      ..tables['backlog_items'] = <Map<String, dynamic>>[backlogRow('b1', 'Optics PYQs')]
      ..tables['mistakes'] = <Map<String, dynamic>>[mistakeRow('m1', 'c1', 'Kirchhoff loop sign slip')];
    final DataController data = await backend.controller();
    await data.load();
    return (backend, data);
  }

  List<String> ids(FakeBackend backend, String table) => (backend.tables[table] ?? const <Map<String, dynamic>>[])
      .map((Map<String, dynamic> r) => r['id'] as String)
      .toList();

  test('offline add, edit and delete across tasks, backlog, chapters, tests and mistakes sync on reconnect', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    backend.offline = true;

    // Add.
    final DailyTask task = DailyTask.fromMap(taskRow('d2', 'Optics DPP', '2026-10-25'));
    await expectLater(data.saveTask(task), completes);
    await expectLater(data.saveBacklog(BacklogItem.fromMap(backlogRow('b2', 'Thermo notes'))), completes);
    // Edit.
    await data.saveTask(data.state.data.tasks.firstWhere((DailyTask t) => t.id == 'd1').copyWith(isCompleted: true));
    final Chapter c1 = data.state.data.chapters.firstWhere((Chapter c) => c.id == 'c1');
    await data.saveChapter(c1.copyWith(name: 'Current Electricity (DC)'));
    await data.saveMistake(data.state.data.mistakes.single.copyWith(retryStatus: 'retried'));
    // Delete.
    await data.deleteTest(data.state.data.tests.single);
    await data.deleteBacklog(data.state.data.backlogItems.firstWhere((BacklogItem b) => b.id == 'b1'));
    await data.deleteChapter(data.state.data.chapters.firstWhere((Chapter c) => c.id == 'c2'));

    // All kept on the phone, nothing rolled back, no error shown.
    expect(data.state.error, isNull);
    expect(data.state.data.tasks.map((DailyTask t) => t.id), containsAll(<String>['d1', 'd2']));
    expect(data.state.data.tasks.firstWhere((DailyTask t) => t.id == 'd1').isCompleted, isTrue);
    expect(data.state.data.backlogItems.map((BacklogItem b) => b.id), <String>['b2']);
    expect(data.state.data.chapters.map((Chapter c) => c.name), <String>['Current Electricity (DC)']);
    expect(data.state.data.tests, isEmpty);
    expect(data.state.pending, greaterThan(0));
    expect(data.state.offline, isTrue);
    // The cloud is untouched while offline.
    expect(ids(backend, 'daily_tasks'), <String>['d1']);
    expect(ids(backend, 'tests'), <String>['t1']);

    // Back online: everything goes up and the reload agrees with the phone.
    backend.offline = false;
    await data.syncNow();
    expect(data.state.pending, 0);
    expect(data.state.error, isNull);
    expect(ids(backend, 'daily_tasks'), unorderedEquals(<String>['d1', 'd2']));
    expect(
        backend.tables['daily_tasks']!.firstWhere((Map<String, dynamic> r) => r['id'] == 'd1')['is_completed'], true);
    expect(ids(backend, 'backlog_items'), <String>['b2'], reason: 'b1 deleted (tombstone), b2 added');
    expect(ids(backend, 'chapters'), <String>['c1']);
    expect(backend.tables['chapters']!.single['name'], 'Current Electricity (DC)');
    expect(ids(backend, 'tests'), isEmpty);
    expect(backend.tables['mistakes']!.single['retry_status'], 'retried');
    expect(data.state.data.tests, isEmpty, reason: 'a deleted row never comes back');
    expect(data.state.data.backlogItems.map((BacklogItem b) => b.id), <String>['b2']);
    data.dispose();
  });

  test('a load while changes are queued keeps the phone copy instead of the stale cloud copy', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    backend.offline = true;
    await data.deleteTest(data.state.data.tests.single);
    await data.load();
    expect(data.state.data.tests, isEmpty);
    expect(data.state.pending, greaterThan(0));
    expect(ids(backend, 'tests'), <String>['t1'], reason: 'nothing sent while offline');
    expect(data.state.error, isNull, reason: 'no "no internet" error while offline');
    data.dispose();
  });

  test('the queue survives a restart and is sent by the next session', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    backend.offline = true;
    await data.saveTask(DailyTask.fromMap(taskRow('d9', 'Kept across restart', '2026-10-25')));
    await data.deleteBacklog(data.state.data.backlogItems.single);
    expect(data.state.pending, 2);
    data.dispose();

    // "Restart": a new controller on the same device storage.
    final DataController reopened = DataController(
      repository: backend.repository,
      preferences: await SharedPreferences.getInstance(),
      userId: 'u1',
    );
    expect(reopened.state.pending, 2);
    expect(reopened.hasLocalCopy, isTrue, reason: 'opens from the phone copy, even offline');
    expect(reopened.state.data.tasks.map((DailyTask t) => t.id), contains('d9'));
    await reopened.load(); // still offline: stays on the phone copy, quietly
    expect(reopened.state.error, isNull);
    expect(reopened.state.data.backlogItems, isEmpty);

    backend.offline = false;
    await reopened.load(); // flushes first, then reloads
    expect(reopened.state.pending, 0);
    expect(ids(backend, 'daily_tasks'), contains('d9'));
    expect(ids(backend, 'backlog_items'), isEmpty);
    expect(reopened.state.data.tasks.map((DailyTask t) => t.id), contains('d9'));
    reopened.dispose();
  });

  test('a known-offline phone queues at once without trying the network', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    data.setNetworkAvailable(false);
    final int before = backend.requests.length;
    await data.saveTask(DailyTask.fromMap(taskRow('d3', 'Quick add', '2026-10-25')));
    expect(backend.requests.length, before, reason: 'no doomed request');
    expect(data.state.pending, 1);
    data.setNetworkAvailable(true); // connectivity back: sends automatically
    await pumpEventQueue(times: 50);
    expect(data.state.pending, 0);
    expect(ids(backend, 'daily_tasks'), contains('d3'));
    data.dispose();
  });

  test('a server rejection of a queued change undoes it and says so; the rest still sync', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    backend.offline = true;
    await data.saveBacklog(BacklogItem.fromMap(backlogRow('b3', 'Rejected one')));
    await data.saveTask(DailyTask.fromMap(taskRow('d4', 'Accepted one', '2026-10-25')));
    backend.offline = false;
    backend.failures['backlog_items'] = postgrestError('23514', 'violates check constraint');
    await data.syncNow();
    expect(data.state.pending, 0);
    expect(ids(backend, 'daily_tasks'), contains('d4'));
    expect(data.state.data.backlogItems.map((BacklogItem b) => b.id), isNot(contains('b3')), reason: 'rolled back');
    expect(data.state.error, contains('could not be saved'));
    data.dispose();
  });

  test('a validation failure online still rolls back and reports', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    backend.failures['daily_tasks'] = postgrestError('23514', 'violates check constraint');
    await expectLater(data.saveTask(DailyTask.fromMap(taskRow('d5', 'Bad', '2026-10-25'))), throwsA(anything));
    expect(data.state.data.tasks.map((DailyTask t) => t.id), isNot(contains('d5')));
    expect(data.state.pending, 0);
    data.dispose();
  });

  group('sync queue', () {
    test('repeated edits of the same row coalesce into one upsert; deletes are tombstones', () {
      List<SyncOp> q = <SyncOp>[];
      q = enqueueSyncOp(q, SyncOp.upsert('daily_tasks', <Map<String, dynamic>>[taskRow('d1', 'a', '2026-10-25')]));
      q = enqueueSyncOp(q, SyncOp.upsert('daily_tasks', <Map<String, dynamic>>[taskRow('d1', 'b', '2026-10-25')]));
      expect(q, hasLength(1));
      expect(q.single.rows.single['title'], 'b');
      q = enqueueSyncOp(q, SyncOp.delete('daily_tasks', <String>['d1']));
      expect(q.map((SyncOp op) => op.kind), <String>['upsert', 'delete']);
      final List<SyncOp> restored = q.map((SyncOp op) => SyncOp.fromJson(op.toJson())).whereType<SyncOp>().toList();
      expect(restored.map((SyncOp op) => op.kind), <String>['upsert', 'delete']);
    });

    test('retries back off from 2 s to at most 60 s', () {
      expect(syncRetryDelay(0), const Duration(seconds: 2));
      expect(syncRetryDelay(1), const Duration(seconds: 4));
      expect(syncRetryDelay(10), const Duration(seconds: 60));
    });
  });
}
