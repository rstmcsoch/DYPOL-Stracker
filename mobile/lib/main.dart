import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'core/config.dart';
import 'core/theme/theme_controller.dart';

/// SharedPreferences instance created before the widget tree, so appearance and the offline
/// cache can be read on the very first frame. Overridden in [main] and required by anything
/// that persists local state.
final Provider<SharedPreferences> preferencesProvider = Provider<SharedPreferences>(
  (Ref ref) => throw UnimplementedError('preferencesProvider must be overridden in main()'),
);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Every orientation is allowed: the layout adapts instead of locking the phone.
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  // Standard Android chrome: the status and navigation bars are painted, not transparent.
  // Drawing under them (edge to edge) is what made the top strip look like a detached grey
  // block over the app bar. Each page re-applies the right bar colours from the theme.
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual, overlays: SystemUiOverlay.values);
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Color(0xFFF7F4EC),
    statusBarIconBrightness: Brightness.dark,
    systemNavigationBarColor: Color(0xFFF7F4EC),
    systemNavigationBarIconBrightness: Brightness.dark,
    systemNavigationBarDividerColor: Colors.transparent,
  ));

  final SharedPreferences preferences = await SharedPreferences.getInstance();

  if (AppConfig.hasSupabaseConfig) {
    // The project is compiled in (see core/config.dart); PKCE + deep links mean the
    // email-confirmation and password-recovery links return to this app.
    await Supabase.initialize(
      url: AppConfig.supabaseUrl,
      anonKey: AppConfig.supabaseAnonKey,
      authOptions: const FlutterAuthClientOptions(
        authFlowType: AuthFlowType.pkce,
        detectSessionInUri: true,
      ),
    );
  }

  runApp(
    ProviderScope(
      overrides: <Override>[
        preferencesProvider.overrideWithValue(preferences),
        themeControllerProvider.overrideWith(
          (Ref ref) => ThemeController(preferences),
        ),
      ],
      child: const StrackerApp(),
    ),
  );
}
