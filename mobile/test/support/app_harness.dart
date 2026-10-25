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
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/main.dart' show preferencesProvider;

/// Phone portrait, in logical pixels.
const Size phoneSize = Size(412, 915);

/// Tablet landscape (gets the permanent sidebar).
const Size tabletLandscape = Size(1280, 800);

/// Pumps [home] the way the app is built: a root scope with the device preferences and
/// theme, and the signed-in account scope (holding [data]) under the navigator.
Future<ProviderContainer> pumpSignedIn(
  WidgetTester tester,
  Widget home, {
  required DataController data,
  Size size = phoneSize,
}) async {
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = size * 2;
  tester.view.padding = const FakeViewPadding(top: 48, bottom: 32);
  tester.view.viewPadding = const FakeViewPadding(top: 48, bottom: 32);
  addTearDown(tester.view.reset);
  final SharedPreferences prefs = await SharedPreferences.getInstance();
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
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: buildStrackerTheme(palette: strackerPalettes['default']!['light']!, brightness: Brightness.light),
        builder: (BuildContext context, Widget? child) => UncontrolledProviderScope(container: signedIn, child: child!),
        home: home,
      ),
    ),
  );
  await settle(tester);
  return signedIn;
}

/// Real app fonts, so widths match the device instead of the square test glyphs.
Future<void> loadAppFonts() async {
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

/// Lets route transitions and short animations finish (pumpAndSettle would wait on the
/// looping loaders forever).
Future<void> settle(WidgetTester tester, {int frames = 4}) async {
  for (int i = 0; i < frames; i += 1) {
    await tester.pump(const Duration(milliseconds: 300));
  }
}
