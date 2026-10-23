/// Build-time configuration for Stracker.
///
/// The app talks to one account service: the project the Stracker website already uses.
/// Its address and its **public** key are part of the app, exactly as they are part of the
/// website's JavaScript bundle — a public key identifies the project, it does not grant
/// access to anything on its own. Row-level security on the server decides what each
/// signed-in account may read and write.
///
/// They are baked in so a build cannot point at the wrong project — that mistake is what
/// made a correct password look wrong. A build-time `--dart-define` used to be enough to
/// move the app, so a stale CI secret silently produced an APK that could not see anyone's
/// account. An override is therefore **opt-in and explicit**:
///
///   flutter build apk --release \
///     --dart-define=ALLOW_PROJECT_OVERRIDE=true \
///     --dart-define=SUPABASE_URL=https://<other-project>.supabase.co \
///     --dart-define=SUPABASE_ANON_KEY=<its public key>
///
/// Without `ALLOW_PROJECT_OVERRIDE`, whatever a CI secret says is ignored.
///
/// Never put a service-role key, a database password or an AI provider key in this file:
/// those never belong on a phone.
class AppConfig {
  const AppConfig._();

  /// The project the website uses: `tkggckwksoatbswrebpu`.
  static const String _projectUrl = 'https://tkggckwksoatbswrebpu.supabase.co';

  /// Public anon key of the same project. Safe to ship: it is the same value the website
  /// sends, and every row is protected by the account's own rules on the server.
  static const String _projectKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'
      'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrZ2dja3drc29hdGJzd3JlYnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0MDIxMjgsImV4cCI6MjEwNjk3ODEyOH0.'
      'XmoGho5bwT-Fbx2On0rq1vaok_k_2CiRPGhHHjjXfFU';

  /// Only a build that says so on purpose may move to another project.
  static const bool _allowOverride = bool.fromEnvironment('ALLOW_PROJECT_OVERRIDE');

  static const String _envUrl = String.fromEnvironment('SUPABASE_URL');
  static const String _envKey = String.fromEnvironment('SUPABASE_ANON_KEY');

  static const String supabaseUrl =
      _allowOverride && _envUrl != '' ? _envUrl : _projectUrl;

  static const String supabaseAnonKey =
      _allowOverride && _envKey != '' ? _envKey : _projectKey;

  /// Where the AI assistant's server endpoints live. Override with
  /// `--dart-define=API_BASE_URL=...` for a staging deployment.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://dypol-stracker.vercel.app',
  );

  /// Public website origin. Used for links the app deliberately leaves to the browser.
  static const String siteUrl = String.fromEnvironment(
    'SITE_URL',
    defaultValue: 'https://dypol-stracker.vercel.app',
  );

  /// Custom URL scheme registered in AndroidManifest.xml for the password-recovery link.
  static const String authRedirectUrl = 'stracker://reset-password';

  static bool get hasSupabaseConfig =>
      supabaseUrl.trim().isNotEmpty && supabaseAnonKey.trim().isNotEmpty;

  /// True when this build was compiled against the project the website uses.
  static bool get pointsAtMainProject => supabaseUrl.contains('tkggckwksoatbswrebpu');
}
