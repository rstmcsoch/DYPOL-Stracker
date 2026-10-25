import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stracker/core/theme/app_theme.dart';
import 'package:stracker/core/theme/palettes.dart';
import 'package:stracker/core/theme/theme_controller.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/repository.dart';
import 'package:stracker/features/home/home_page.dart';
import 'package:stracker/features/settings/settings_page.dart';
import 'package:stracker/features/shell/app_shell.dart';
import 'package:stracker/features/shell/routes.dart';
import 'package:stracker/main.dart' show preferencesProvider;
import 'package:supabase_flutter/supabase_flutter.dart';

// Regression for the owner's screenshots: on Settings (a section pushed inside the shell)
// the Ask Stracker and quick-action buttons slid behind the floating bottom tabs. They must
// sit in the same place on every page, above the tabs, saved or unsaved.

Future<void> _setWindow(WidgetTester tester, Size size) async {
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = size * 2;
  tester.view.padding = const FakeViewPadding(top: 48, bottom: 32);
  tester.view.viewPadding = const FakeViewPadding(top: 48, bottom: 32);
}

Future<void> _pump(WidgetTester tester, Widget home, {double textScale = 1}) async {
  SharedPreferences.setMockInitialValues(<String, Object>{});
  final SharedPreferences prefs = await SharedPreferences.getInstance();
  final DataController data = DataController(
    repository: StrackerRepository(SupabaseClient(
      'http://127.0.0.1:1',
      'x',
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    )),
    preferences: prefs,
    userId: 'u1',
  );
  final StrackerPalette palette = strackerPalettes['default']!['light']!;
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        preferencesProvider.overrideWithValue(prefs),
        themeControllerProvider.overrideWith((Ref ref) => ThemeController(prefs)),
        dataControllerProvider.overrideWith((Ref ref) => data),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: buildStrackerTheme(palette: palette, brightness: Brightness.light),
        builder: (BuildContext context, Widget? child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: home,
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 400));
}

/// Lets a route transition finish (pumpAndSettle would wait on the sync spinner forever).
Future<void> _settle(WidgetTester tester) async {
  for (int i = 0; i < 4; i += 1) {
    await tester.pump(const Duration(milliseconds: 300));
  }
}

Finder get _bottomTabs => find.byKey(const ValueKey<String>('bottom-tabs'));

/// Real app fonts, so widths match the device instead of the square test glyphs.
Future<void> _loadFonts() async {
  final Map<String, FontLoader> loaders = <String, FontLoader>{};
  for (final FileSystemEntity file in Directory('assets/fonts').listSync()) {
    final String name = file.uri.pathSegments.last;
    if (!name.endsWith('.ttf') && !name.endsWith('.otf')) continue;
    final String family = name.split('-').first.split('.').first;
    loaders.putIfAbsent(family, () => FontLoader(family)).addFont(rootBundle.load('assets/fonts/$name'));
  }
  for (final FontLoader loader in loaders.values) {
    await loader.load();
  }
}

Finder get _bar => find.descendant(of: _bottomTabs, matching: find.byType(FrostedBar));
Finder get _ai => find.bySemanticsLabel('Ask Stracker');
Finder get _quick => find.bySemanticsLabel('Open quick actions');

const List<(String, Size)> _bottomBarSizes = <(String, Size)>[
  ('phone 360x780', Size(360, 780)),
  ('phone 412x915', Size(412, 915)),
  ('tablet portrait 800x1280', Size(800, 1280)),
];

Future<void> _open(WidgetTester tester, String route) async {
  final BuildContext context = tester.element(find.byType(HomePage));
  unawaited(Routes.open(context, route));
  await _settle(tester);
}

/// Both buttons visible, inside the window and fully above the bottom tabs.
(Rect, Rect) _expectClearOfTabs(WidgetTester tester, String where) {
  expect(_ai, findsOneWidget, reason: '$where: Ask Stracker shows');
  expect(_quick, findsOneWidget, reason: '$where: quick actions show');
  final Rect ai = tester.getRect(_ai);
  final Rect quick = tester.getRect(_quick);
  final Rect bar = tester.getRect(_bar);
  for (final (String name, Rect r) in <(String, Rect)>[('Ask Stracker', ai), ('quick actions', quick)]) {
    expect(r.bottom, lessThanOrEqualTo(bar.top - 8), reason: '$where: $name sits above the bottom tabs');
    expect(r.overlaps(bar), isFalse, reason: '$where: $name never overlaps the tabs');
    expect(r.top, greaterThan(0));
  }
  expect(ai.bottom, lessThanOrEqualTo(quick.top), reason: '$where: the two buttons stack, not overlap');
  return (ai, quick);
}

void main() {
  setUpAll(_loadFonts);

  for (final (String name, Size size) in _bottomBarSizes) {
    testWidgets('$name: floating buttons sit above the tabs on Home, Settings (saved and unsaved) and sections',
        (WidgetTester tester) async {
      addTearDown(tester.view.reset);
      await _setWindow(tester, size);
      await _pump(tester, const AppShell());
      final (Rect homeAi, Rect homeQuick) = _expectClearOfTabs(tester, 'Home');

      await _open(tester, Routes.settings);
      expect(find.byType(SettingsPage), findsOneWidget);
      expect(find.text('Synced with your account'), findsOneWidget);
      final (Rect ai, Rect quick) = _expectClearOfTabs(tester, 'Settings saved');
      expect(quick.bottom, moreOrLessEquals(homeQuick.bottom, epsilon: 1), reason: 'same place as on the tabs');
      expect(ai.right, moreOrLessEquals(homeAi.right, epsilon: 1));

      // Unsaved changes: the header grows a Save action; the buttons must not move or overlap.
      await tester.enterText(find.byType(TextField).first, '95');
      await tester.pump();
      expect(find.text('Unsaved changes'), findsOneWidget);
      final (_, Rect dirtyQuick) = _expectClearOfTabs(tester, 'Settings unsaved');
      expect(dirtyQuick.bottom, moreOrLessEquals(quick.bottom, epsilon: 1));

      // Scrolled to the end, the Save settings button clears both floating buttons.
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump();
      await tester.drag(find.byType(ListView).first, const Offset(0, -6000));
      await _settle(tester);
      // Item 1 of the final polish: the Connection check row is gone from Settings.
      expect(find.text('Connection check'), findsNothing);
      expect(find.text('Test the link between this phone and your account'), findsNothing);
      expect(find.text('Sign out'), findsWidgets, reason: 'the rest of the account card stays');
      final Finder save = find.text('Save settings');
      expect(save, findsOneWidget);
      final Rect saveRect = tester.getRect(find.ancestor(of: save, matching: find.byType(ElevatedButton)));
      expect(saveRect.overlaps(tester.getRect(_ai)), isFalse, reason: 'Save settings stays clear of Ask Stracker');
      expect(saveRect.overlaps(tester.getRect(_quick)), isFalse);
      expect(saveRect.overlaps(tester.getRect(_bar)), isFalse);
      expect(tester.takeException(), isNull);

      for (final String route in <String>[Routes.syllabus, Routes.mistakes, Routes.planner]) {
        await tester.binding.handlePopRoute();
        await _settle(tester);
        await _open(tester, route);
        // Pages with their own add button stack it under the pair, so only clearance is fixed.
        _expectClearOfTabs(tester, route);
      }
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('landscape tablet (sidebar): buttons stay inside the window on Settings', (WidgetTester tester) async {
    addTearDown(tester.view.reset);
    await _setWindow(tester, const Size(1280, 800));
    await _pump(tester, const AppShell());
    final Rect homeQuick = tester.getRect(_quick);
    await _open(tester, Routes.settings);
    final Rect quick = tester.getRect(_quick);
    expect(quick.bottom, lessThanOrEqualTo(800 - 32), reason: 'clear of the system inset');
    expect(quick.bottom, moreOrLessEquals(homeQuick.bottom, epsilon: 1));
    expect(tester.getRect(_ai).bottom, lessThanOrEqualTo(quick.top));
    expect(tester.takeException(), isNull);
  });
}
