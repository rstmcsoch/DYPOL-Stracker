import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stracker/app.dart' show signedInContainer;
import 'package:stracker/core/theme/app_theme.dart';
import 'package:stracker/core/theme/palettes.dart';
import 'package:stracker/core/theme/theme_controller.dart';
import 'package:stracker/core/widgets/wandering_eyes.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/repository.dart';
import 'package:stracker/features/focus/focus_controller.dart';
import 'package:stracker/features/home/home_page.dart';
import 'package:stracker/features/profile/appearance_card.dart';
import 'package:stracker/features/profile/profile_page.dart';
import 'package:stracker/features/settings/settings_page.dart';
import 'package:stracker/features/shell/app_shell.dart';
import 'package:stracker/features/shell/routes.dart';
import 'package:stracker/main.dart' show preferencesProvider;
import 'package:supabase_flutter/supabase_flutter.dart';

/// Builds the app the way the real one is built: a root [ProviderScope] holding the device
/// preferences and the theme, and, under it, the signed-in container from [signedInContainer]
/// holding the account data. Earlier the signed-in container had no parent, so every page
/// that read the theme (Settings, Profile's appearance, the theme toggle) threw while
/// building and rendered blank in release builds. These tests use the real two-level setup.
Future<ProviderContainer> _pumpSignedIn(WidgetTester tester, Widget home) async {
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(412, 915) * 2;
  tester.view.padding = const FakeViewPadding(top: 48, bottom: 32);
  tester.view.viewPadding = const FakeViewPadding(top: 48, bottom: 32);
  addTearDown(tester.view.reset);
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
  final ProviderContainer root = ProviderContainer(
    overrides: <Override>[
      preferencesProvider.overrideWithValue(prefs),
      themeControllerProvider.overrideWith((Ref ref) => ThemeController(prefs)),
    ],
  );
  addTearDown(root.dispose);
  final ProviderContainer signedIn = signedInContainer(root, data);
  addTearDown(signedIn.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: root,
      child: Consumer(
        builder: (BuildContext context, WidgetRef ref, _) {
          final ThemeState theme = ref.watch(themeControllerProvider);
          final bool dark = theme.mode == ThemeMode.dark;
          final StrackerPalette palette = strackerPalettes['default']![dark ? 'dark' : 'light']!;
          return MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: buildStrackerTheme(palette: palette, brightness: dark ? Brightness.dark : Brightness.light),
            // As in the app, everything under the navigator (pages, sheets) is account-scoped.
            builder: (BuildContext context, Widget? child) =>
                UncontrolledProviderScope(container: signedIn, child: child!),
            home: home,
          );
        },
      ),
    ),
  );
  await _settle(tester);
  return signedIn;
}

/// Scrolls [finder] to the middle of the screen, clear of the floating bars.
Future<void> _center(WidgetTester tester, Finder finder) async {
  await Scrollable.ensureVisible(tester.element(finder), alignment: 0.5);
  await tester.pump();
}

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

/// Lets a route transition finish (pumpAndSettle would wait on the loaders forever).
Future<void> _settle(WidgetTester tester) async {
  for (int i = 0; i < 4; i += 1) {
    await tester.pump(const Duration(milliseconds: 300));
  }
}

void main() {
  setUpAll(_loadFonts);

  test('a container without the root parent cannot see the theme (the blank-Settings cause)', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final ProviderContainer root = ProviderContainer(
      overrides: <Override>[themeControllerProvider.overrideWith((Ref ref) => ThemeController(prefs))],
    );
    addTearDown(root.dispose);
    final DataController data = DataController(
      repository: StrackerRepository(SupabaseClient('http://127.0.0.1:1', 'x')),
      preferences: prefs,
      userId: 'u1',
    );
    final ProviderContainer orphan = ProviderContainer(
      overrides: <Override>[dataControllerProvider.overrideWith((Ref ref) => data)],
    );
    addTearDown(orphan.dispose);
    expect(() => orphan.read(themeControllerProvider), throwsA(anything));
    final ProviderContainer child = signedInContainer(root, data);
    addTearDown(child.dispose);
    expect(child.read(themeControllerProvider).mode, ThemeMode.system);
    expect(child.read(dataControllerProvider.notifier), same(data));
    // Account-derived state lives in the account container, never in the root.
    expect(() => child.read(focusControllerProvider), returnsNormally);
  });

  testWidgets('Settings opens with content in the signed-in scope', (WidgetTester tester) async {
    await _pumpSignedIn(tester, const SettingsPage());
    expect(tester.takeException(), isNull);
    expect(find.text('Settings'), findsWidgets);
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey<String>('settings-sign-out')),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await _center(tester, find.byKey(const ValueKey<String>('settings-sign-out')));
    await tester.tap(find.byKey(const ValueKey<String>('settings-sign-out')));
    await _settle(tester);
    expect(find.text('Sign out?'), findsOneWidget, reason: 'sign-out always asks first');
    await tester.tap(find.text('Cancel'));
    await _settle(tester);
    expect(find.byKey(const ValueKey<String>('settings-sign-out')), findsOneWidget);
    expect(find.text('Notebook theme'), findsNothing, reason: 'appearance is chosen in Profile only');
  });

  testWidgets('changing the theme in Profile, then opening Settings, never goes blank', (WidgetTester tester) async {
    final ProviderContainer container = await _pumpSignedIn(tester, const ProfilePage());
    expect(find.byType(AppearanceCard), findsOneWidget);
    for (final (String choice, ThemeMode mode) in <(String, ThemeMode)>[
      ('Chalkboard', ThemeMode.dark),
      ('Warm paper', ThemeMode.light),
      ('Auto', ThemeMode.system),
      ('Chalkboard', ThemeMode.dark),
    ]) {
      await _center(tester, find.text(choice));
      await tester.tap(find.text(choice));
      await _settle(tester);
      expect(tester.takeException(), isNull, reason: 'after choosing $choice');
      expect(find.byType(AppearanceCard), findsOneWidget);
      expect(container.read(themeControllerProvider).mode, mode);
    }
    expect(container.read(themeControllerProvider).mode, ThemeMode.dark);
    unawaited(Routes.open(tester.element(find.byType(ProfilePage)), Routes.settings));
    await _settle(tester);
    expect(tester.takeException(), isNull);
    expect(find.byType(SettingsPage), findsOneWidget);
    expect(find.text('Account & data'), findsWidgets);
  });

  final List<String> routes = <String>[
    Routes.syllabus,
    Routes.tests,
    Routes.practice,
    Routes.pyqs,
    Routes.mistakes,
    Routes.retry,
    Routes.planner,
    Routes.revision,
    Routes.analytics,
    Routes.weakAreas,
    Routes.mockAnalysis,
    Routes.backlog,
    Routes.decks,
    Routes.focus,
    Routes.studyNow,
    Routes.backup,
    Routes.settings,
    Routes.profile,
    'ai',
  ];
  for (final String key in routes) {
    testWidgets('route "$key" opens a non-blank page inside the shell', (WidgetTester tester) async {
      await _pumpSignedIn(tester, const AppShell());
      unawaited(Routes.open(tester.element(find.byType(HomePage)), key));
      await _settle(tester);
      expect(tester.takeException(), isNull);
      final Widget page = Routes.pageFor(key)!;
      final Finder shown = find.byType(page.runtimeType);
      expect(shown, findsOneWidget);
      // Non-blank: the page draws its header and some text of its own.
      expect(find.descendant(of: shown, matching: find.byType(Text)), findsWidgets);
      expect(find.descendant(of: shown, matching: find.byType(FrostedBar)), findsWidgets);
    });
  }

  testWidgets('no theme toggle, exam chip or menu sign-out in the shell', (WidgetTester tester) async {
    await _pumpSignedIn(tester, const AppShell());
    expect(find.byTooltip('Switch theme'), findsNothing);
    final Finder bars = find.byType(FrostedBar);
    expect(find.descendant(of: bars, matching: find.text('JEE 2027')), findsNothing);
    expect(find.descendant(of: bars, matching: find.textContaining('JEE')), findsNothing);
    await tester.tap(find.bySemanticsLabel('Open navigation').first);
    await _settle(tester);
    expect(find.byType(NotebookDrawer), findsOneWidget);
    expect(find.descendant(of: find.byType(NotebookDrawer), matching: find.text('Sign out')), findsNothing);
  });

  group('WanderingEyes', () {
    Future<void> pumpEyes(WidgetTester tester, {bool reduceMotion = false}) async {
      final StrackerPalette palette = strackerPalettes['default']!['dark']!;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildStrackerTheme(palette: palette, brightness: Brightness.dark),
          home: MediaQuery(
            data: MediaQueryData(disableAnimations: reduceMotion),
            child: const Scaffold(body: Center(child: WanderingEyes())),
          ),
        ),
      );
    }

    Finder paint() => find.descendant(of: find.byType(WanderingEyes), matching: find.byType(CustomPaint));

    testWidgets('stays hidden for quick waits, then shows', (WidgetTester tester) async {
      await pumpEyes(tester);
      expect(paint(), findsNothing);
      await tester.pump(const Duration(milliseconds: 150));
      expect(paint(), findsNothing);
      await tester.pump(const Duration(milliseconds: 200));
      expect(paint(), findsOneWidget);
      await tester.pump(const Duration(seconds: 2));
      expect(tester.takeException(), isNull);
    });

    testWidgets('holds still when the device asks for reduced motion', (WidgetTester tester) async {
      await pumpEyes(tester, reduceMotion: true);
      await tester.pump(const Duration(milliseconds: 400));
      expect(paint(), findsOneWidget);
      expect(tester.hasRunningAnimations, isFalse);
    });
  });
}
