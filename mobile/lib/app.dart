import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/theme/app_theme.dart';
import 'core/theme/palettes.dart';
import 'core/theme/theme_controller.dart';
import 'data/data_controller.dart';
import 'data/models.dart';
import 'data/repository.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/auth_screens.dart';
import 'features/focus/focus_controller.dart';
import 'features/onboarding/onboarding_overlay.dart';
import 'features/shell/app_shell.dart';
import 'features/splash/splash_page.dart';
import 'logic/onboarding.dart';
import 'main.dart' show preferencesProvider;

class StrackerApp extends ConsumerWidget {
  const StrackerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ThemeState appearance = ref.watch(themeControllerProvider);
    final Map<String, StrackerPalette>? palette = strackerPalettes[appearance.paletteId];
    final Map<String, StrackerPalette> fallback = strackerPalettes['default']!;
    return MaterialApp(
      title: 'Stracker',
      debugShowCheckedModeBanner: false,
      themeMode: appearance.mode,
      theme: buildStrackerTheme(
        palette: palette?['light'] ?? fallback['light']!,
        brightness: Brightness.light,
        readingFont: appearance.readingFont,
      ),
      darkTheme: buildStrackerTheme(
        palette: palette?['dark'] ?? fallback['dark']!,
        brightness: Brightness.dark,
        readingFont: appearance.readingFont,
      ),
      builder: (BuildContext context, Widget? child) {
        // The status and navigation bar icons follow the active palette on every screen -
        // splash, sign-in, sheets and pages alike.
        final bool dark = switch (appearance.mode) {
          ThemeMode.dark => true,
          ThemeMode.light => false,
          ThemeMode.system => MediaQuery.platformBrightnessOf(context) == Brightness.dark,
        };
        // System text scaling is honoured but clamped: below 0.85 the notebook's labels
        // stop being legible, and above 1.6 the fixed-width tables break.
        return AnnotatedRegion<SystemUiOverlayStyle>(
          // Edge to edge: both system bars are transparent and the page (with the soft
          // fades behind the floating bars) shows through, instead of fixed solid strips.
          value: SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            statusBarIconBrightness: dark ? Brightness.light : Brightness.dark,
            statusBarBrightness: dark ? Brightness.dark : Brightness.light,
            systemNavigationBarColor: Colors.transparent,
            systemNavigationBarIconBrightness: dark ? Brightness.light : Brightness.dark,
            systemNavigationBarDividerColor: Colors.transparent,
            systemNavigationBarContrastEnforced: false,
            systemStatusBarContrastEnforced: false,
          ),
          child: MediaQuery.withClampedTextScaling(
            minScaleFactor: 0.85,
            maxScaleFactor: 1.6,
            child: child ?? const SizedBox.shrink(),
          ),
        );
      },
      home: const RootGate(),
    );
  }
}

/// Chooses between splash, configuration help, auth, password recovery and the notebook.
class RootGate extends ConsumerWidget {
  const RootGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AuthStatus status = ref.watch(authControllerProvider);
    if (status.misconfigured) return const ConfigMissingPage();
    if (status.initializing) return const SplashPage();
    if (!status.signedIn) return const AuthFlow();
    if (status.recoveryMode) return const ResetPasswordScreen();
    return SignedInScope(session: status.session!);
  }
}

/// Creates the account-scoped notebook container once per signed-in user. Everything below
/// this point can read [dataControllerProvider].
class SignedInScope extends ConsumerStatefulWidget {
  const SignedInScope({super.key, required this.session});

  final Session session;

  @override
  ConsumerState<SignedInScope> createState() => _SignedInScopeState();
}

class _SignedInScopeState extends ConsumerState<SignedInScope> {
  late final ProviderContainer _container;
  late final DataController _data;
  late final SharedPreferences _preferences;

  @override
  void initState() {
    super.initState();
    _preferences = ref.read(preferencesProvider);
    _data = DataController(
      repository: StrackerRepository(Supabase.instance.client),
      preferences: _preferences,
      userId: widget.session.user.id,
    );
    _container = signedInContainer(ProviderScope.containerOf(context, listen: false), _data);
    // Load after the first frame so the shell paints immediately with cached data.
    WidgetsBinding.instance.addPostFrameCallback((_) => _data.load());
  }

  @override
  void dispose() {
    _container.dispose();
    _data.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return UncontrolledProviderScope(
      container: _container,
      child: const _NotebookApp(),
    );
  }
}

class _NotebookApp extends ConsumerStatefulWidget {
  const _NotebookApp();

  @override
  ConsumerState<_NotebookApp> createState() => _NotebookAppState();
}

class _NotebookAppState extends ConsumerState<_NotebookApp> {
  AppSettings? _applied;
  bool _onboardingShown = false;

  @override
  Widget build(BuildContext context) {
    final DataState state = ref.watch(dataControllerProvider);

    // The account's settings decide the palette, mode and reading font. Apply once per
    // distinct settings value so this never loops with the appearance save in Profile.
    final AppSettings settings = state.data.settings;
    if (!identical(settings, _applied) && state.lastSyncedAt != null) {
      _applied = settings;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ref.read(themeControllerProvider.notifier).syncFromSettings(settings);
      });
    }

    if (state.error != null && state.data.chapters.isEmpty && state.loading) {
      return const SplashPage();
    }
    // First-run setup waits for this account's real settings (a successful cloud load),
    // so a cached or default copy never flashes it, and once up it stays until saved.
    final bool needed = needsOnboarding(settings);
    if (!needed) _onboardingShown = false;
    final bool showOnboarding = shouldShowOnboarding(
      needed: needed,
      loading: state.loading,
      synced: state.lastSyncedAt != null,
      alreadyShown: _onboardingShown,
    );
    if (showOnboarding) _onboardingShown = true;
    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        ExcludeSemantics(
          excluding: showOnboarding,
          child: IgnorePointer(ignoring: showOnboarding, child: const AppShell()),
        ),
        if (showOnboarding) const OnboardingOverlay(),
      ],
    );
  }
}

/// The account-scoped container. It is a child of the root container, so everything the
/// root overrides (preferences, the theme controller) resolves to the same instance here.
///
/// A standalone container (no parent) used to be created instead. Inside it the theme
/// controller and preferences providers fell back to their throwing defaults, so any widget
/// that watched the theme (Settings, the appearance choices) threw while building. A release
/// build renders a build error as an empty box, which is the blank Settings page.
///
/// Riverpod resolves a provider that is not overridden here in the root container, so every
/// provider that reads the account data must be overridden here too, or it would be created
/// in the root where there is no account. Today that is only the focus timer (which is per
/// account anyway, and is disposed with this container on sign-out).
ProviderContainer signedInContainer(ProviderContainer root, DataController data) => ProviderContainer(
      parent: root,
      overrides: <Override>[
        dataControllerProvider.overrideWith((Ref ref) => data),
        focusControllerProvider.overrideWith((Ref ref) => FocusController(ref)),
      ],
    );
