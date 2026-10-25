import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/features/shell/app_shell.dart';
import 'package:stracker/features/tests/tests_page.dart';

import 'support/app_harness.dart';
import 'support/fake_backend.dart';
import 'support/seed.dart';

void main() {
  setUpAll(loadAppFonts);

  Future<(FakeBackend, DataController)> seeded() async {
    final FakeBackend backend = FakeBackend()
      ..tables['chapters'] = <Map<String, dynamic>>[chapterRow('c1', 'Units and dimensions')]
      ..tables['tests'] = <Map<String, dynamic>>[testRow('t1', 'Allen minor test 7')];
    final DataController data = await backend.controller();
    await data.load();
    return (backend, data);
  }

  testWidgets('editing a test shows Mock analysis and Delete as real buttons, and Delete confirms first',
      (WidgetTester tester) async {
    final (FakeBackend backend, DataController data) = (await tester.runAsync(seeded))!;
    await pumpSignedIn(tester, const TestsPage(), data: data);
    await tester.tap(find.text('Allen minor test 7').first);
    await settle(tester, frames: 3);

    final Finder mock = find.widgetWithText(OutlinedButton, 'Mock analysis');
    final Finder delete = find.widgetWithText(OutlinedButton, 'Delete');
    expect(mock, findsOneWidget);
    expect(find.descendant(of: mock, matching: find.byIcon(Icons.insights_outlined)), findsOneWidget);
    expect(delete, findsOneWidget);
    expect(tester.getTopLeft(mock).dy, tester.getTopLeft(delete).dy, reason: 'side by side in one row');
    final Color deleteColour = tester
            .widget<Text>(find.descendant(of: delete, matching: find.text('Delete')))
            .style
            ?.color ??
        DefaultTextStyle.of(tester.element(find.descendant(of: delete, matching: find.text('Delete')))).style.color!;
    expect(deleteColour.r, greaterThan(deleteColour.g), reason: 'Delete reads as a danger action');

    await tester.ensureVisible(delete);
    await tester.tap(delete);
    await settle(tester, frames: 2);
    expect(find.text('Delete this test?'), findsOneWidget);
    await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Cancel')));
    await settle(tester, frames: 2);
    expect(backend.requests.where((RecordedRequest r) => r.method == 'DELETE'), isEmpty, reason: 'cancel keeps it');

    await tester.tap(delete);
    await settle(tester, frames: 2);
    await tester.tap(find.widgetWithText(FilledButton, 'Delete').last);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await settle(tester, frames: 3);
    expect(
      backend.requests.where((RecordedRequest r) => r.method == 'DELETE').map((RecordedRequest r) => r.target),
      containsAll(<String>['tests', 'test_subject_scores', 'test_chapter_links']),
    );
    expect(data.state.data.tests, isEmpty);
    expect(find.text('Test deleted.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the tablet sidebar list is clipped so a highlight never paints over the logo or search',
      (WidgetTester tester) async {
    final (_, DataController data) = (await tester.runAsync(seeded))!;
    await pumpSignedIn(tester, const AppShell(), data: data, size: tabletLandscape);
    final Finder clip = find.ancestor(
      of: find.widgetWithText(ListTile, 'Tests').first,
      matching: find.byWidgetPredicate(
        (Widget w) => w is Material && w.type == MaterialType.transparency && w.clipBehavior == Clip.hardEdge,
      ),
    );
    expect(clip, findsOneWidget);
    final Rect list = tester.getRect(clip);
    final Rect search = tester.getRect(find.widgetWithText(ListTile, 'Search notebook').first);
    expect(list.top, greaterThanOrEqualTo(search.bottom - 0.5), reason: 'the list starts below the fixed search row');
  });
}
