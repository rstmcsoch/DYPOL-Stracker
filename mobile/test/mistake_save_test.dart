import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/errors.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/features/retry/retry_page.dart';

import 'support/app_harness.dart';
import 'support/fake_backend.dart';
import 'support/seed.dart';

/// Regression for the Retry list's red "LateInitializationError: Local 'stored' has not
/// been initialized": every mistake save read a `late` local in its optimistic step,
/// before the upload had assigned it.
void main() {
  late SchemaSnapshot schema;
  setUpAll(() async {
    schema = SchemaSnapshot.load();
    await loadAppFonts();
  });

  Future<(FakeBackend, DataController)> seeded() async {
    final FakeBackend backend = FakeBackend()
      ..tables['chapters'] = <Map<String, dynamic>>[chapterRow('c1', 'Current Electricity')]
      ..tables['mistakes'] = <Map<String, dynamic>>[
        mistakeRow('m1', 'c1', 'Kirchhoff loop sign slip', retryLater: true),
      ];
    final DataController data = await backend.controller();
    await data.load();
    return (backend, data);
  }

  test('mark retried saves the row, with a payload that fits the live schema', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    final Mistake m = data.state.data.mistakes.single;
    await data.saveMistake(m.copyWith(retryLater: false, retryStatus: 'retried'));
    final Map<String, dynamic> sent = backend.rowsSentTo('mistakes').single;
    expect(sent['id'], 'm1');
    expect(sent['retry_status'], 'retried');
    expect(sent['retry_later'], false);
    expectFitsSchema(schema, 'mistakes', sent);
    expect(data.state.data.mistakes.single.retryStatus, 'retried');
    expect(data.state.saving, isFalse);
    expect(data.state.error, isNull);
  });

  test('keep for later saves pending without a LateInitializationError', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    final Mistake m = data.state.data.mistakes.single;
    await expectLater(data.saveMistake(m.copyWith(retryLater: false, retryStatus: 'pending')), completes);
    expect(backend.rowsSentTo('mistakes').single['retry_status'], 'pending');
    expect(data.state.data.pendingRetries, isEmpty);
  });

  test('a rejected save rolls back and reports a plain message, never the raw error', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    backend.failures['mistakes'] = postgrestError('23514', 'new row violates check constraint "mistakes_x"');
    final Mistake m = data.state.data.mistakes.single;
    Object? caught;
    try {
      await data.saveMistake(m.copyWith(retryStatus: 'retried', retryLater: false));
    } catch (error) {
      caught = error;
    }
    expect(caught, isA<AppFailure>());
    final String message = userMessage(caught!);
    expect(message, isNot(contains('constraint')));
    expect(message, isNot(contains('LateInitialization')));
    expect(data.state.data.mistakes.single.retryStatus, 'pending', reason: 'optimistic change rolled back');
    expect(data.state.data.mistakes.single.retryLater, isTrue);
    expect(data.state.saving, isFalse);
  });

  test('offline save is kept on the device and queued, then synced', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    backend.offline = true;
    final Mistake m = data.state.data.mistakes.single;
    await expectLater(data.saveMistake(m.copyWith(retryStatus: 'retried')), completes);
    expect(data.state.data.mistakes.single.retryStatus, 'retried', reason: 'no rollback offline');
    expect(data.state.pending, 1);
    expect(data.state.error, isNull);
    backend.offline = false;
    await data.syncNow();
    expect(backend.tables['mistakes']!.single['retry_status'], 'retried');
    expect(data.state.pending, 0);
    data.dispose();
  });

  test('a new image is uploaded to the private bucket, then the row stores its path', () async {
    final (FakeBackend backend, DataController data) = await seeded();
    final Directory dir = await Directory.systemTemp.createTemp('stracker-test');
    addTearDown(() => dir.delete(recursive: true));
    final File image = File('${dir.path}/note.webp')..writeAsBytesSync(<int>[1, 2, 3, 4]);
    final Mistake m = data.state.data.mistakes.single;
    await data.saveMistake(m.copyWith(solutionNote: 'Use the loop rule.'), image: image);
    final RecordedRequest upload = backend.requests.firstWhere((RecordedRequest r) => r.service == 'storage');
    expect(upload.target, 'mistake-images');
    expect(upload.url.path, endsWith('/u1/m1.webp'));
    final Map<String, dynamic> sent = backend.rowsSentTo('mistakes').single;
    expect(sent['image_path'], 'u1/m1.webp');
    expectFitsSchema(schema, 'mistakes', sent);
    expect(data.state.data.mistakes.single.imagePath, 'u1/m1.webp');
  });

  testWidgets('Retry list buttons save and confirm, with no error snackbar', (WidgetTester tester) async {
    final (FakeBackend backend, DataController data) = await tester.runAsync(seeded) as (FakeBackend, DataController);
    await pumpSignedIn(tester, const RetryPage(), data: data);
    expect(find.text('Kirchhoff loop sign slip'), findsOneWidget);
    // Proper buttons now, not text links.
    expect(find.widgetWithText(OutlinedButton, 'Keep for later'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, 'Reveal my note'), findsOneWidget);
    await tester.tap(find.text('Reveal my note'));
    await tester.pump();
    expect(find.text('Remember the sign convention.'), findsOneWidget);
    await tester.runAsync(() async {
      await tester.tap(find.text('Mark retried'));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await settle(tester, frames: 2);
    expect(find.textContaining('LateInitializationError'), findsNothing);
    expect(find.textContaining('Marked retried'), findsOneWidget);
    expect(backend.rowsSentTo('mistakes').single['retry_status'], 'retried');
    expect(tester.takeException(), isNull);
  });
}
