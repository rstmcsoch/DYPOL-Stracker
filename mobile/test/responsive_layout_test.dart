import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stracker/core/layout.dart';
import 'package:stracker/core/theme/app_theme.dart';
import 'package:stracker/core/theme/palettes.dart';
import 'package:stracker/core/widgets/notebook.dart';
import 'package:stracker/core/theme/theme_controller.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/repository.dart';
import 'package:stracker/features/backlog/backlog_page.dart';
import 'package:stracker/features/analytics/weak_areas_page.dart';
import 'package:stracker/features/studynow/study_now_page.dart';
import 'package:stracker/features/revision/revision_page.dart';
import 'package:stracker/features/pyq/pyq_page.dart';
import 'package:stracker/features/practice/practice_page.dart';
import 'package:stracker/features/mock/mock_analysis_page.dart';
import 'package:stracker/features/backup/backup_page.dart';
import 'package:stracker/features/home/home_page.dart';
import 'package:stracker/features/profile/profile_page.dart';
import 'package:stracker/features/decks/decks_page.dart';
import 'package:stracker/features/syllabus/syllabus_page.dart';
import 'package:stracker/features/tests/tests_page.dart';
import 'package:stracker/features/focus/focus_page.dart';
import 'package:stracker/features/mistakes/mistakes_page.dart';
import 'package:stracker/features/planner/planner_page.dart';
import 'package:stracker/features/retry/retry_page.dart';
import 'package:stracker/features/settings/settings_page.dart';
import 'package:stracker/features/shell/app_shell.dart';
import 'package:stracker/main.dart' show preferencesProvider;
import 'package:supabase_flutter/supabase_flutter.dart';

/// Window sizes from the brief: small, mid and large phones, a tablet in portrait and the
/// same tablet in landscape. Logical (dp) sizes.
const List<(String, Size, bool)> _sizes = <(String, Size, bool)>[
  ('phone 360x780', Size(360, 780), false),
  ('phone 412x915', Size(412, 915), false),
  ('phone 430x932', Size(430, 932), false),
  ('phone landscape 915x412', Size(915, 412), false),
  ('tablet portrait 800x1280', Size(800, 1280), false),
  ('tablet landscape 1280x800', Size(1280, 800), true),
];

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

Finder get _sidebar => find.byKey(const ValueKey<String>('sidebar'));
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

void main() {
  setUpAll(_loadFonts);

  test('sidebar only on landscape tablets (Material expanded width)', () {
    expect(AppLayout.useSidebar(const Size(360, 780)), isFalse);
    expect(AppLayout.useSidebar(const Size(915, 412)), isFalse, reason: 'landscape phone keeps the bottom bar');
    expect(AppLayout.useSidebar(const Size(800, 1280)), isFalse, reason: 'portrait tablet keeps the bottom bar');
    expect(AppLayout.useSidebar(const Size(1280, 800)), isTrue);
    expect(AppLayout.useSidebar(const Size(840, 700)), isTrue);
  });

  for (final (String name, Size size, bool sidebar) in _sizes) {
    testWidgets('shell at $name: no overflow, ${sidebar ? 'sidebar' : 'bottom bar'}', (WidgetTester tester) async {
      addTearDown(tester.view.reset);
      await _setWindow(tester, size);
      await _pump(tester, const AppShell());
      expect(tester.takeException(), isNull);
      expect(_sidebar, sidebar ? findsOneWidget : findsNothing);
      expect(_bottomTabs, sidebar ? findsNothing : findsOneWidget);
      // Content is capped like the desktop website instead of stretching edge to edge.
      for (final Element element in find.byType(ContentWidth).evaluate()) {
        final Finder box = find.descendant(of: find.byWidget(element.widget), matching: find.byType(ConstrainedBox));
        expect(tester.getSize(box.first).width, lessThanOrEqualTo(AppLayout.contentMaxWidth + 0.5));
      }
    });
  }

  testWidgets('rotation switches the navigation live and keeps the selected tab', (WidgetTester tester) async {
    addTearDown(tester.view.reset);
    await _setWindow(tester, const Size(800, 1280));
    await _pump(tester, const AppShell());
    expect(_bottomTabs, findsOneWidget);
    await tester.tap(find.descendant(of: _bottomTabs, matching: find.text('Analytics')));
    await tester.pump(const Duration(milliseconds: 400));

    await _setWindow(tester, const Size(1280, 800));
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);
    expect(_sidebar, findsOneWidget);
    expect(_bottomTabs, findsNothing);
    final ListTile analytics = tester.widget<ListTile>(
      find.ancestor(
          of: find.descendant(of: _sidebar, matching: find.text('Analytics')), matching: find.byType(ListTile)),
    );
    expect(analytics.selected, isTrue, reason: 'the tab survives the rotation');

    await _setWindow(tester, const Size(800, 1280));
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);
    expect(_bottomTabs, findsOneWidget);
    expect(find.descendant(of: _bottomTabs, matching: find.bySemanticsLabel('Analytics')), findsOneWidget);
  });

  testWidgets('landscape tablet: a section opens beside the sidebar and back closes it', (WidgetTester tester) async {
    addTearDown(tester.view.reset);
    await _setWindow(tester, const Size(1280, 800));
    await _pump(tester, const AppShell());
    await tester.tap(find.descendant(of: _sidebar, matching: find.text('Syllabus')));
    await _settle(tester);
    expect(tester.takeException(), isNull);
    expect(find.byType(SyllabusPage), findsOneWidget);
    expect(_sidebar, findsOneWidget, reason: 'the sidebar stays, like the desktop website');
    expect(find.bySemanticsLabel('Open navigation'), findsNothing);

    // Android back pops the section inside the content area, not the app.
    await tester.binding.handlePopRoute();
    await _settle(tester);
    expect(find.byType(SyllabusPage), findsNothing);
    expect(_sidebar, findsOneWidget);
  });

  testWidgets('phone: two-line menu on the right opens the drawer; sections keep the bottom bar',
      (WidgetTester tester) async {
    addTearDown(tester.view.reset);
    await _setWindow(tester, const Size(412, 915));
    await _pump(tester, const AppShell());
    final Finder menu = find.bySemanticsLabel('Open navigation');
    expect(menu, findsOneWidget);
    expect(tester.getCenter(menu).dx, greaterThan(412 * 0.75), reason: 'top-right, as on the mobile website');
    await tester.tap(menu);
    await _settle(tester);
    await tester.tap(find.descendant(of: find.byType(Drawer), matching: find.text('Syllabus')).first);
    await _settle(tester);
    expect(tester.takeException(), isNull);
    expect(find.byType(SyllabusPage), findsOneWidget);
    expect(_bottomTabs, findsOneWidget, reason: 'the floating bar stays on every page');
    expect(menu, findsOneWidget, reason: 'sections keep the menu button');

    await tester.binding.handlePopRoute();
    await _settle(tester);
    expect(find.byType(SyllabusPage), findsNothing);

    // Profile has no menu button, as on the website.
    await tester.tap(find.descendant(of: _bottomTabs, matching: find.bySemanticsLabel('Profile')));
    await _settle(tester);
    expect(find.descendant(of: find.byType(ProfilePage), matching: menu), findsNothing);
    expect(find.descendant(of: find.byType(HomePage), matching: menu), findsOneWidget);
  });

  testWidgets('Android back order: drawer first, then tab to Home, then the system default',
      (WidgetTester tester) async {
    addTearDown(tester.view.reset);
    await _setWindow(tester, const Size(412, 915));
    await _pump(tester, const AppShell());
    await tester.tap(find.descendant(of: _bottomTabs, matching: find.bySemanticsLabel('Tests')));
    await _settle(tester);
    await tester.tap(find.descendant(of: find.byType(TestsPage), matching: find.bySemanticsLabel('Open navigation')));
    await _settle(tester);
    expect(find.byType(Drawer), findsOneWidget);

    // 1) closes the drawer, 2) returns to Home, 3) on Home back is left to Android.
    expect(await tester.binding.handlePopRoute(), isTrue);
    await _settle(tester);
    expect(find.byType(Drawer), findsNothing);
    expect(find.byType(AppShell), findsOneWidget);
    expect(await tester.binding.handlePopRoute(), isTrue);
    await _settle(tester);
    expect(
        find.descendant(of: find.byType(HomePage), matching: find.bySemanticsLabel('Open navigation')), findsOneWidget);
    expect(find.byType(AppShell), findsOneWidget);
  });

  testWidgets('smallest phone with large system font scale does not overflow', (WidgetTester tester) async {
    addTearDown(tester.view.reset);
    await _setWindow(tester, const Size(360, 780));
    await _pump(tester, const AppShell(), textScale: 1.3);
    expect(tester.takeException(), isNull);
    expect(_bottomTabs, findsOneWidget);
  });

  final Map<String, Widget> pages = <String, Widget>{
    'Backlog': const BacklogPage(),
    'Mistakes': const MistakesPage(),
    'Retry': const RetryPage(),
    'Planner': const PlannerPage(),
    'Settings': const SettingsPage(),
    'Focus': const FocusPage(),
    'Syllabus': const SyllabusPage(),
    'Decks': const DecksPage(),
    'Backup': const BackupPage(),
    'MockAnalysis': const MockAnalysisPage(),
    'Practice': const PracticePage(),
    'Pyq': const PyqPage(),
    'Revision': const RevisionPage(),
    'StudyNow': const StudyNowPage(),
    'WeakAreas': const WeakAreasPage(),
  };
  for (final MapEntry<String, Widget> page in pages.entries) {
    for (final (String name, Size size, bool _) in _sizes) {
      testWidgets('${page.key} page at $name: no overflow', (WidgetTester tester) async {
        addTearDown(tester.view.reset);
        await _setWindow(tester, size);
        await _pump(tester, page.value);
        expect(tester.takeException(), isNull);
      });
    }
    testWidgets('${page.key} page at 360x780 with 1.3x system font: no overflow', (WidgetTester tester) async {
      addTearDown(tester.view.reset);
      await _setWindow(tester, const Size(360, 780));
      await _pump(tester, page.value, textScale: 1.3);
      expect(tester.takeException(), isNull);
    });
  }
}
