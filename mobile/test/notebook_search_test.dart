import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/features/backlog/backlog_page.dart';
import 'package:stracker/features/decks/decks_page.dart';
import 'package:stracker/features/mistakes/mistakes_page.dart';
import 'package:stracker/features/planner/planner_page.dart';
import 'package:stracker/features/search/notebook_search.dart';
import 'package:stracker/features/search/search_focus.dart';
import 'package:stracker/features/shell/app_shell.dart';
import 'package:stracker/features/syllabus/syllabus_page.dart';
import 'package:stracker/features/tests/tests_page.dart';
import 'package:stracker/logic/search.dart';

import 'support/app_harness.dart';
import 'support/fake_backend.dart';
import 'support/seed.dart';

Future<DataController> _seeded() async {
  final FakeBackend backend = FakeBackend()
    ..tables['chapters'] = <Map<String, dynamic>>[
      for (int i = 0; i < 30; i += 1) chapterRow('c$i', 'Filler chapter $i', position: i),
      chapterRow('c-ce', 'Current Electricity', position: 31),
    ]
    ..tables['tests'] = <Map<String, dynamic>>[testRow('t1', 'Allen minor test 7')]
    ..tables['mistakes'] = <Map<String, dynamic>>[mistakeRow('m1', 'c-ce', 'Wheatstone bridge balance slip')]
    ..tables['daily_tasks'] = <Map<String, dynamic>>[taskRow('d1', 'Solve kinematics DPP', '2026-11-04')]
    ..tables['backlog_items'] = <Map<String, dynamic>>[
      backlogRow('b1', 'Rotational lecture 4'),
      backlogRow('b2', 'Thermodynamics topic cleared', status: 'done'),
    ]
    ..tables['study_cards'] = <Map<String, dynamic>>[cardRow('s1', 'c-ce', 'Ohm law formula')];
  final DataController data = await backend.controller();
  await data.load();
  return data;
}

Future<void> _openSearch(WidgetTester tester) async {
  await tester.tap(find.bySemanticsLabel('Search notebook').first);
  await settle(tester, frames: 2);
}

Future<void> _search(WidgetTester tester, String query) async {
  await tester.enterText(find.byKey(const ValueKey<String>('notebook-search-field')), query);
  await tester.pump();
}

/// The [SearchTargetState] of the item with [id].
SearchTargetState _target(WidgetTester tester, String id) => tester.state<SearchTargetState>(
      find.byWidgetPredicate((Widget w) => w is SearchTarget && w.id == id),
    );

void main() {
  setUpAll(loadAppFonts);

  group('searchNotebook', () {
    late AppData data;
    setUpAll(() async => data = (await _seeded()).state.data);

    test('finds every kind of item, like the website plus backlog and cards', () {
      expect(searchNotebook(data, 'current electricity').map((SearchHit h) => h.kind), contains(SearchKind.chapter));
      expect(searchNotebook(data, 'allen').single.kind, SearchKind.test);
      expect(searchNotebook(data, 'wheatstone').single.kind, SearchKind.mistake);
      expect(searchNotebook(data, 'kinematics').single.kind, SearchKind.task);
      expect(searchNotebook(data, 'rotational').single.kind, SearchKind.backlog);
      expect(searchNotebook(data, 'ohm').single.kind, SearchKind.card);
    });

    test('every word has to match, in any order, ignoring case and spacing', () {
      expect(searchNotebook(data, '  BRIDGE   wheatstone ').single.id, 'm1');
      expect(searchNotebook(data, 'wheatstone kinematics'), isEmpty);
      expect(searchNotebook(data, '   '), isEmpty);
    });

    test('a mistake is also found by its chapter name', () {
      expect(searchNotebook(data, 'electricity').map((SearchHit h) => h.id), containsAll(<String>['c-ce', 'm1']));
    });
  });

  group('search window', () {
    testWidgets('is a compact centred window with autofocus, closing on X, outside tap and back',
        (WidgetTester tester) async {
      final DataController data = (await tester.runAsync(_seeded))!;
      await pumpSignedIn(tester, const AppShell(), data: data);
      await _openSearch(tester);
      expect(find.byType(NotebookSearchDialog), findsOneWidget);
      expect(tester.takeException(), isNull);
      final Rect box = tester.getRect(
        find.ancestor(of: find.text('Search notebook').last, matching: find.byType(Material)).first,
      );
      expect(box.width, closeTo(412 * 0.9, 1), reason: '90% of a phone');
      expect(box.height, lessThanOrEqualTo(915 * 0.7));
      expect(box.center.dx, closeTo(206, 1));
      expect(find.byType(BackdropFilter), findsWidgets, reason: 'blurred backdrop');
      final EditableText field = tester.widget<EditableText>(find.byType(EditableText).last);
      expect(field.focusNode.hasFocus, isTrue, reason: 'autofocus');

      await tester.tap(find.byTooltip('Close search'));
      await settle(tester, frames: 2);
      expect(find.byType(NotebookSearchDialog), findsNothing);

      await _openSearch(tester);
      await tester.tapAt(const Offset(8, 880));
      await settle(tester, frames: 2);
      expect(find.byType(NotebookSearchDialog), findsNothing, reason: 'tap outside closes');

      await _openSearch(tester);
      await tester.binding.handlePopRoute();
      await settle(tester, frames: 2);
      expect(find.byType(NotebookSearchDialog), findsNothing, reason: 'back closes');
    });

    testWidgets('caps at 560 wide on a landscape tablet', (WidgetTester tester) async {
      final DataController data = (await tester.runAsync(_seeded))!;
      await pumpSignedIn(tester, const AppShell(), data: data, size: tabletLandscape);
      await _openSearch(tester);
      final Rect box = tester.getRect(
        find.ancestor(of: find.text('Search notebook').last, matching: find.byType(Material)).first,
      );
      expect(box.width, 560);
      expect(box.center.dx, closeTo(640, 1), reason: 'centred on the screen, not the content area');
      await _search(tester, 'allen');
      expect(find.descendant(of: find.byType(NotebookSearchDialog), matching: find.text('Allen minor test 7')),
          findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    final List<(String, String, Type, String)> cases = <(String, String, Type, String)>[
      ('chapter', 'current electricity', SyllabusPage, 'c-ce'),
      ('test', 'allen', TestsPage, 't1'),
      ('mistake', 'wheatstone', MistakesPage, 'm1'),
      ('task', 'kinematics', PlannerPage, 'd1'),
      ('backlog', 'rotational', BacklogPage, 'b1'),
      ('cleared backlog', 'thermodynamics', BacklogPage, 'b2'),
    ];
    for (final (String label, String query, Type page, String id) in cases) {
      testWidgets('a $label result opens its section on that item, highlighted', (WidgetTester tester) async {
        final DataController data = (await tester.runAsync(_seeded))!;
        await pumpSignedIn(tester, const AppShell(), data: data);
        await _openSearch(tester);
        await _search(tester, query);
        final Finder hit = find.byWidgetPredicate(
          (Widget w) =>
              w is ListTile && w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.endsWith('-$id'),
        );
        expect(hit, findsOneWidget);
        await tester.tap(hit);
        await settle(tester, frames: 3);
        expect(find.byType(NotebookSearchDialog), findsNothing);
        expect(find.byType(page), findsWidgets);
        final SearchTargetState target = _target(tester, id);
        expect(target.highlighted, isTrue);
        // Scrolled into view, below the floating header and above the bottom bar.
        final Rect rect = tester.getRect(find.byWidget(target.widget));
        expect(rect.top, greaterThan(60));
        expect(rect.top, lessThan(915 - 120));
        expect(tester.takeException(), isNull);
        await tester.pump(const Duration(seconds: 3));
        expect(target.highlighted, isFalse, reason: 'the highlight fades');
      });
    }

    testWidgets('a card result opens that card in Formulas & flashcards', (WidgetTester tester) async {
      final DataController data = (await tester.runAsync(_seeded))!;
      await pumpSignedIn(tester, const AppShell(), data: data);
      await _openSearch(tester);
      await _search(tester, 'ohm');
      await tester.tap(find.descendant(of: find.byType(NotebookSearchDialog), matching: find.text('Ohm law formula')));
      await settle(tester, frames: 3);
      expect(find.byType(DecksPage), findsWidgets);
      expect(find.text('Save card'), findsOneWidget, reason: 'the card editor is open on that card');
      expect(find.widgetWithText(OutlinedButton, 'Delete'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the sidebar search row opens the same window', (WidgetTester tester) async {
      final DataController data = (await tester.runAsync(_seeded))!;
      await pumpSignedIn(tester, const AppShell(), data: data, size: tabletLandscape);
      await tester.tap(find.widgetWithText(ListTile, 'Search notebook'));
      await settle(tester, frames: 2);
      expect(find.byType(NotebookSearchDialog), findsOneWidget);
      unawaited(tester.binding.handlePopRoute());
      await settle(tester, frames: 2);
    });
  });
}
