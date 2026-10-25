import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/widgets/fields.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/features/decks/decks_page.dart';
import 'package:stracker/features/focus/focus_controller.dart';
import 'package:stracker/features/planner/planner_page.dart';
import 'package:stracker/features/syllabus/syllabus_page.dart';
import 'package:stracker/logic/revision.dart';

import 'support/app_harness.dart';
import 'support/fake_backend.dart';
import 'support/seed.dart';

/// Checkpoint (c) of the end-to-end audit: saves in the Planner, Syllabus (chapter sheet,
/// stages, revision scheduling, reordering), Revisions, Formulas & flashcards and Focus,
/// with every payload checked against the live schema.
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
        chapterRow('c4', 'Magnetism', position: 3),
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

  Future<void> centre(WidgetTester tester, Finder target) async {
    await Scrollable.ensureVisible(tester.element(target), alignment: 0.5);
    await tester.pump();
  }

  Future<void> wait(WidgetTester tester) async {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await settle(tester, frames: 3);
  }

  Future<void> tapButton(WidgetTester tester, String label) async {
    final Finder button = find
        .ancestor(of: find.text(label), matching: find.byWidgetPredicate((Widget w) => w is ButtonStyleButton))
        .last;
    await centre(tester, button);
    await tester.tap(button);
    await wait(tester);
  }

  group('Syllabus chapter sheet', () {
    testWidgets('stage chips, revision scheduling and Up/Down act on live rows', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      await pumpSignedIn(tester, const SyllabusPage(), data: data);
      await tester.tap(find.text('Current Electricity').first);
      await settle(tester, frames: 3);

      // Theory on, then off again: the second toggle must update the same row.
      for (int i = 0; i < 2; i++) {
        final Finder chip = find.widgetWithText(FilterChip, 'Theory');
        await centre(tester, chip);
        await tester.tap(chip);
        await wait(tester);
      }
      final List<Map<String, dynamic>> stageRows = backend.rowsSentTo('chapter_stages');
      expect(stageRows, hasLength(2));
      expect(stageRows[1]['id'], stageRows[0]['id'], reason: 'unique (chapter_id, stage): reuse the row');
      expect(backend.tables['chapter_stages']!.single['done'], isFalse);
      expect(tester.widget<FilterChip>(find.widgetWithText(FilterChip, 'Theory')).selected, isFalse);

      // Schedule twice: the second tap sees the live revision and writes nothing.
      await tapButton(tester, 'Schedule revision');
      await tapButton(tester, 'Schedule revision');
      expect(backend.tables['chapter_revisions'], hasLength(1));
      expect(backend.tables['chapter_revisions']!.single['revision_number'], 1);

      // Down twice: c1 moves below c2, then below c4.
      await tapButton(tester, 'Down');
      await tapButton(tester, 'Down');
      List<String> order() => data.state.data.chaptersFor('Physics').map((Chapter c) => c.id).toList();
      expect(order(), <String>['c2', 'c4', 'c1']);

      // Saving the sheet keeps the moved position (the sheet's base row is live too).
      await tapButton(tester, 'Save notes');
      expect(order(), <String>['c2', 'c4', 'c1']);
      backend.expectAllWritesFit(schema);
      expect(tester.takeException(), isNull);
    });

    test('a new ladder continues after finished rungs instead of reusing R1', () async {
      final (FakeBackend backend, DataController data) = await seeded(
        extra: (FakeBackend b) => b.tables['chapter_revisions'] = <Map<String, dynamic>>[
          for (int n = 1; n <= 3; n++)
            <String, dynamic>{
              'id': 'r$n',
              'user_id': 'u1',
              'chapter_id': 'c1',
              'revision_number': n,
              'due_on': '2026-10-0$n',
              'completed_at': '2026-10-0${n}T10:00:00Z',
              'created_at': '2026-10-01T10:00:00Z',
              'updated_at': '2026-10-01T10:00:00Z',
            },
        ],
      );
      final AppData snapshot = data.state.data;
      final Revision next = startRevisionChain(snapshot, 'c1');
      expect(next.revisionNumber, 4);
      expect(startRevisionChain(snapshot, 'c2').revisionNumber, 1);
      await data.saveRevision(next);
      expect(backend.tables['chapter_revisions'], hasLength(4));
      backend.expectAllWritesFit(schema);
    });
  });

  group('Planner', () {
    testWidgets('an offline task is saved on the phone at once, then synced once online', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      await pumpSignedIn(tester, const PlannerPage(), data: data);
      await tester.tap(find.text('Add task').first);
      await settle(tester, frames: 3);
      await tester.enterText(field('Task'), 'Solve 20 Kirchhoff problems');
      backend.offline = true;
      await tapButton(tester, 'Add task');
      expect(find.textContaining('Check your connection'), findsNothing, reason: 'no failure toast offline');
      expect(data.state.data.tasks.single.title, 'Solve 20 Kirchhoff problems', reason: 'kept, not rolled back');
      expect(data.state.pending, 1);
      expect(backend.tables['daily_tasks'] ?? const <Object>[], isEmpty);
      backend.offline = false;
      await tester.runAsync(() => data.syncNow());
      expect(data.state.pending, 0);
      expect(data.state.data.tasks.single.title, 'Solve 20 Kirchhoff problems');
      expect(backend.tables['daily_tasks'], hasLength(1));
      backend.expectAllWritesFit(schema);
      expect(tester.takeException(), isNull);
    });
  });

  group('Formulas & flashcards', () {
    testWidgets('a double-tapped rating saves once and the next card starts hidden', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(() => seeded(
            extra: (FakeBackend b) => b.tables['study_cards'] = <Map<String, dynamic>>[
              cardRow('k1', 'c1', 'Ohm law'),
              cardRow('k2', 'c1', 'Power'),
            ],
          )))!;
      await pumpSignedIn(tester, const DecksPage(), data: data);
      await tapButton(tester, 'Show answer');
      final Finder good = find.byKey(const ValueKey<String>('rate-good'));
      await centre(tester, good);
      await tester.tap(good);
      await tester.tap(good, warnIfMissed: false);
      await wait(tester);
      expect(backend.writesTo('study_cards'), hasLength(1));
      expect(find.text('Show answer'), findsOneWidget, reason: 'the next card must not open revealed');
      backend.expectAllWritesFit(schema);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a long deck lists every card through Show more', (WidgetTester tester) async {
      final (FakeBackend _, DataController data) = (await tester.runAsync(() => seeded(
            extra: (FakeBackend b) => b.tables['study_cards'] = <Map<String, dynamic>>[
              for (int i = 0; i < 45; i++) cardRow('k$i', 'c1', 'Card $i'),
            ],
          )))!;
      await pumpSignedIn(tester, const DecksPage(), data: data);
      final Finder more = find.byKey(const ValueKey<String>('decks-show-more'));
      await centre(tester, more);
      expect(find.text('Show 20 more (24 left)'), findsOneWidget);
      await tester.tap(more);
      await settle(tester, frames: 2);
      await centre(tester, more);
      expect(find.text('Show 4 more (4 left)'), findsOneWidget);
      await tester.tap(more);
      await settle(tester, frames: 2);
      expect(more, findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a double-tapped Add card creates one card', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      await pumpSignedIn(tester, const DecksPage(), data: data);
      await tester.tap(find.byTooltip('Add card'));
      await settle(tester, frames: 3);
      await tester.enterText(field('Formula name or prompt'), 'Capacitance');
      await tester.enterText(field('Formula'), 'C = εA / d');
      final Finder add = find
          .ancestor(of: find.text('Add card'), matching: find.byWidgetPredicate((Widget w) => w is ButtonStyleButton))
          .last;
      await centre(tester, add);
      await tester.tap(add);
      await tester.tap(add, warnIfMissed: false);
      await wait(tester);
      expect(backend.tables['study_cards'], hasLength(1));
      backend.expectAllWritesFit(schema);
      expect(tester.takeException(), isNull);
    });
  });

  group('Focus', () {
    testWidgets('a block whose save is rejected is kept on the phone and saved by Retry', (WidgetTester tester) async {
      final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
      final ProviderContainer scope = await pumpSignedIn(tester, const SizedBox(), data: data);
      final FocusController focus = scope.read(focusControllerProvider.notifier);
      DateTime now = DateTime.utc(2026, 10, 25, 10);
      focus.clock = () => now;
      focus.start();
      now = now.add(const Duration(minutes: 12));
      backend.failures['study_sessions'] = postgrestError('XX000', 'server busy');
      final FocusSaveResult failed = (await tester.runAsync(() => focus.end(save: true)))!;
      expect(failed.error, contains('kept on this phone'));
      expect(focus.pending.value, hasLength(1));
      expect(focus.pending.value.single.durationMinutes, 12);
      expect(data.readDeviceValue('focus-pending'), isNotNull, reason: 'survives an app restart');

      backend.failures.remove('study_sessions');
      final FocusSaveResult retried = (await tester.runAsync(focus.retryPending))!;
      expect(retried.error, isNull);
      expect(retried.minutes, 12);
      expect(focus.pending.value, isEmpty);
      expect(data.readDeviceValue('focus-pending'), isNull);
      expect(backend.tables['study_sessions'], hasLength(1));
      // A second retry writes nothing more.
      await tester.runAsync(focus.retryPending);
      expect(backend.writesTo('study_sessions'), hasLength(2), reason: 'one failed try, one save');
      backend.expectAllWritesFit(schema);
    });
  });
}
