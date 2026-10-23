/// Build-time configuration for Stracker.
///
/// Only client-safe values belong here: the Supabase project URL and its public
/// (anon/publishable) key, plus the base URL of the existing Stracker web API that
/// hosts the authenticated `/api/ai/*` endpoints. The service-role key, the AI
/// provider secrets and the AI credential-encryption key must never be placed in
/// the app; they stay in the existing Vercel server environment.
///
/// Supply values at build time:
///   flutter build apk --release \
///     --dart-define=SUPABASE_URL=https://<project>.supabase.co \
///     --dart-define=SUPABASE_ANON_KEY=<public-anon-key>
///
/// `--dart-define-from-file=env.json` works too (see mobile/env.example.json).
class AppConfig {
  const AppConfig._();

  /// Existing Supabase project used by https://dypol-stracker.vercel.app.
  static const String supabaseUrl = String.fromEnvironment('SUPABASE_URL');

  /// Public anon/publishable key. This is the same key the browser bundle uses;
  /// it grants nothing beyond what RLS allows for the signed-in user.
  static const String supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

  /// Base URL of the deployed Stracker website, which also serves the Vercel
  /// `/api/ai/*` functions. Override with --dart-define=API_BASE_URL=...
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://dypol-stracker.vercel.app',
  );

  /// Public website origin. Used for links the app deliberately leaves to the browser,
  /// such as the owner console and the privacy notes.
  static const String siteUrl = String.fromEnvironment(
    'SITE_URL',
    defaultValue: 'https://dypol-stracker.vercel.app',
  );

  /// Custom URL scheme registered in AndroidManifest.xml for the password-recovery
  /// link. The Supabase dashboard must list `stracker://reset-password` under
  /// Authentication → URL Configuration → Redirect URLs.
  static const String authRedirectUrl = 'stracker://reset-password';

  static bool get hasSupabaseConfig =>
      supabaseUrl.trim().isNotEmpty && supabaseAnonKey.trim().isNotEmpty;
}
