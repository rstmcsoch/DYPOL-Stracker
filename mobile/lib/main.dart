import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'core/config.dart';
import 'core/secure_session_storage.dart';
import 'core/theme/theme_controller.dart';

/// SharedPreferences instance created before the widget tree, so appearance and the offline
/// cache can be read on the very first frame. Overridden in [main] and required by anything
/// that persists local state.
final Provider<SharedPreferences> preferencesProvider = Provider<SharedPreferences>(
  (Ref ref) => throw UnimplementedError('preferencesProvider must be overridden in main()'),
);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // A release build renders a layout failure as a grey rectangle. That rectangle is what a
  // student would see over the top of a page, so in release it is replaced by an empty box
  // (the page's own background then shows through) while the error is still reported
  // through FlutterError.onError.
  if (kReleaseMode) {
    ErrorWidget.builder = (FlutterErrorDetails details) => const SizedBox.shrink();
  }

  // Every orientation is allowed: the layout adapts instead of locking the phone.
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  // Edge to edge, as Android 15 requires and as modern apps look: the system bars are
  // transparent (their icon colours come from the active palette in app.dart) and pages
  // draw underneath them, with the floating bars' fades keeping the content readable.
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);

  final SharedPreferences preferences = await SharedPreferences.getInstance();

  if (AppConfig.hasSupabaseConfig) {
    // The project is compiled in (see core/config.dart); PKCE + deep links mean the
    // email-confirmation and password-recovery links return to this app.
    await Supabase.initialize(
      url: AppConfig.supabaseUrl,
      anonKey: AppConfig.supabaseAnonKey,
      authOptions: FlutterAuthClientOptions(
        authFlowType: AuthFlowType.pkce,
        detectSessionInUri: true,
        // Tokens live in the Android Keystore; a session from an older build is moved
        // there once and the plaintext copy is deleted.
        localStorage: SecureSessionStorage(
          persistSessionKey: supabaseSessionKey(AppConfig.supabaseUrl),
        ),
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
