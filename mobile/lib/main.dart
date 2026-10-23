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

  // Portrait first, landscape allowed: the notebook is responsive rather than locked, so a
  // tablet in a keyboard case and a rotated phone both work.
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    systemNavigationBarColor: Colors.transparent,
  ));

  final SharedPreferences preferences = await SharedPreferences.getInstance();

  if (AppConfig.hasSupabaseConfig) {
    // Same project as the website. PKCE + deep links mean the email-confirmation and
    // password-recovery links return to this app instead of the browser.
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
