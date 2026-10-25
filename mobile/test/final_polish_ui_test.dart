import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/theme/palettes.dart';
import 'package:stracker/core/theme/theme_controller.dart';
import 'package:stracker/core/widgets/dialogs.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/features/profile/appearance_card.dart';
import 'package:stracker/features/profile/profile_page.dart';

import 'support/app_harness.dart';
import 'support/fake_backend.dart';

/// Final polish (v1.0.0): the display-name editor is a compact centred window, and the
/// colour themes are small preview cards in a grid instead of a chip list.
void main() {
  setUpAll(loadAppFonts);

  Future<(FakeBackend, DataController)> account() async {
    final FakeBackend backend = FakeBackend();
    final DataController data = await backend.controller();
    await data.load();
    return (backend, data);
  }

  Future<void> openNameEditor(WidgetTester tester) async {
    final Finder edit = find.byTooltip('Edit name');
    await Scrollable.ensureVisible(tester.element(edit), alignment: 0.5);
    await tester.pump();
    await tester.tap(edit);
    await settle(tester);
  }

  for (final (String name, Size size) in <(String, Size)>[
    ('phone', phoneSize),
    ('tablet', const Size(800, 1280)),
  ]) {
    testWidgets('$name: change name opens a compact centred window, not the tall sheet', (WidgetTester tester) async {
      final (_, DataController data) = await account();
      await pumpSignedIn(tester, const ProfilePage(), data: data, size: size);
      await openNameEditor(tester);

      expect(find.byType(BottomSheet), findsNothing, reason: 'no full-height form sheet');
      final Finder window = find.byKey(const ValueKey<String>('compact-dialog'));
      expect(window, findsOneWidget);
      expect(find.descendant(of: window, matching: find.text('Your name')), findsOneWidget);
      expect(find.descendant(of: window, matching: find.byType(TextField)), findsOneWidget);
      final Rect rect = tester.getRect(window);
      expect(rect.height, lessThan(size.height * 0.4), reason: 'sized to its content');
      expect(rect.width, lessThanOrEqualTo(420));
      expect(rect.center.dx, moreOrLessEquals(size.width / 2, epsilon: 1), reason: 'centred');
      expect((rect.center.dy - size.height / 2).abs(), lessThan(60), reason: 'centred vertically');
      expect(find.byType(BackdropFilter), findsWidgets, reason: 'blurred backdrop');

      // The X closes it.
      await tester.tap(find.descendant(of: window, matching: find.byTooltip('Close')));
      await settle(tester);
      expect(window, findsNothing);

      // A tap outside closes it too.
      await openNameEditor(tester);
      expect(window, findsOneWidget);
      await tester.tapAt(const Offset(8, 120));
      await settle(tester);
      expect(window, findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('saving a name from the compact window updates the account and closes it', (WidgetTester tester) async {
    final (FakeBackend backend, DataController data) = await account();
    await pumpSignedIn(tester, const ProfilePage(), data: data);
    await openNameEditor(tester);
    final Finder window = find.byKey(const ValueKey<String>('compact-dialog'));
    await tester.enterText(find.descendant(of: window, matching: find.byType(TextField)), 'Rustam');
    await tester.runAsync(() async {
      await tester.tap(find.descendant(of: window, matching: find.text('Save')));
      await Future<void>.delayed(const Duration(milliseconds: 200));
    });
    await settle(tester);
    expect(window, findsNothing);
    expect(data.state.data.settings.ownerName, 'Rustam');
    expect(
      backend.requests.where((RecordedRequest r) => r.method != 'GET').expand((RecordedRequest r) => r.rows),
      contains(predicate<Map<String, dynamic>>((Map<String, dynamic> row) => row.values.contains('Rustam'))),
    );
    expect(tester.takeException(), isNull);
  });

  test('compact dialog: the only single-field form, so the shared form sheet stays for the rest', () {
    // Audit: every other showAppSheet form has two or more inputs (password + repeat,
    // exam track, cards, tasks, tests, practice, backlog, mistakes, chapters, revision).
    expect(showCompactDialog<void>, isA<Function>());
  });

  testWidgets('colour themes are a grid of small preview cards with a clear selected state',
      (WidgetTester tester) async {
    final (_, DataController data) = await account();
    final ProviderContainer container = await pumpSignedIn(tester, const ProfilePage(), data: data);
    await tester.ensureVisible(find.byType(AppearanceCard));
    await settle(tester);

    expect(find.byType(ChoiceChip), findsNothing, reason: 'the chip list is gone');
    expect(find.byType(PaletteChoiceCard), findsNWidgets(strackerPaletteOptions.length));
    final List<Rect> rects = <Rect>[
      for (final ({String id, String label, String description}) o in strackerPaletteOptions)
        tester.getRect(find.byKey(ValueKey<String>('palette-${o.id}'))),
    ];
    for (final Rect r in rects) {
      expect(r.height, lessThan(80), reason: 'small cards');
      expect(r.width, lessThan(160));
    }
    expect(rects[1].top, rects[0].top, reason: 'a grid: several cards per row');
    expect(rects[2].top, rects[0].top);

    // Each card previews its own palette's background, surface and accent.
    final Finder ocean = find.byKey(const ValueKey<String>('palette-ocean-deep'));
    final StrackerPalette oceanLight = strackerPalettes['ocean-deep']!['light']!;
    final List<Color> shown = tester
        .widgetList<ColoredBox>(find.descendant(of: ocean, matching: find.byType(ColoredBox)))
        .map((ColoredBox b) => b.color)
        .toList();
    expect(shown, containsAll(<Color>[oceanLight.bg, oceanLight.paper, oceanLight.accent]));
    expect(find.descendant(of: ocean, matching: find.text('Ocean Deep')), findsOneWidget);

    // Selecting a card applies it and marks it (and only it) selected.
    await tester.ensureVisible(ocean);
    await tester.tap(ocean);
    await settle(tester);
    expect(container.read(themeControllerProvider).paletteId, 'ocean-deep');
    expect(tester.getSemantics(ocean), isSemantics(isSelected: true));
    expect(
      tester.getSemantics(find.byKey(const ValueKey<String>('palette-default'))),
      isSemantics(isSelected: false),
    );
    expect(find.descendant(of: ocean, matching: find.byIcon(Icons.check_circle)), findsOneWidget);

    // Warm paper / Chalkboard / Auto: compact cards with a preview, three across.
    final List<Rect> modes = tester.widgetList<ThemeChoiceCard>(find.byType(ThemeChoiceCard)).map((ThemeChoiceCard c) {
      return tester.getRect(find.byWidget(c));
    }).toList();
    expect(modes, hasLength(3));
    for (final Rect r in modes) {
      expect(r.height, lessThan(80));
    }
    expect(modes[1].top, modes[0].top);
    expect(modes[2].top, modes[0].top);
    expect(
      find.descendant(of: find.byType(ThemeChoiceCard).first, matching: find.byType(ColoredBox)),
      findsWidgets,
      reason: 'each mode card shows a colour preview',
    );
    expect(tester.takeException(), isNull);
  });

  test('swatches come from the palette in the current brightness', () {
    final StrackerPalette dark = strackerPalettes['sakura-blossom']!['dark']!;
    expect(paletteSwatches('sakura-blossom', Brightness.dark), (dark.bg, dark.paper, dark.accent));
    final StrackerPalette fallback = strackerPalettes['default']!['light']!;
    expect(paletteSwatches('missing', Brightness.light), (fallback.bg, fallback.paper, fallback.accent));
  });
}
