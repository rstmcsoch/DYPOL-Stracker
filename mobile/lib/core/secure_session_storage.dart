import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Minimal key/value surface over the platform keystore, so tests can supply an in-memory
/// version and the app the Android Keystore-backed one.
abstract class SecretStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class KeystoreSecretStore implements SecretStore {
  const KeystoreSecretStore();

  // EncryptedSharedPreferences: values are encrypted with a key held in the Android
  // Keystore. App backup is disabled in the manifest, so a restored copy can never meet a
  // keystore that cannot decrypt it.
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// The Supabase session key supabase_flutter uses by default, so an existing session
/// saved by an older build is found and moved.
String supabaseSessionKey(String supabaseUrl) =>
    'sb-${Uri.parse(supabaseUrl).host.split('.').first}-auth-token';

/// Keeps the Supabase session (access + refresh token) in the Android Keystore instead of
/// plain SharedPreferences.
///
/// On first start after the update, a session saved by an older build in SharedPreferences
/// is copied into secure storage once, read back to confirm, and only then deleted, so the
/// student stays signed in. If the keystore is unusable on a device, the old behaviour
/// (SharedPreferences) is kept rather than signing the student out on every launch.
class SecureSessionStorage extends LocalStorage {
  SecureSessionStorage({
    required this.persistSessionKey,
    SecretStore? secrets,
    Future<SharedPreferences> Function()? preferences,
  })  : _secrets = secrets ?? const KeystoreSecretStore(),
        _preferences = preferences ?? SharedPreferences.getInstance;

  final String persistSessionKey;
  final SecretStore _secrets;
  final Future<SharedPreferences> Function() _preferences;

  late SharedPreferences _prefs;
  bool _secure = true;
  String? _cached;

  /// True when the keystore could not be used and the legacy store is in effect.
  bool get usingFallback => !_secure;

  @override
  Future<void> initialize() async {
    _prefs = await _preferences();
    try {
      _cached = await _secrets.read(persistSessionKey);
      final String? legacy = _prefs.getString(persistSessionKey);
      if (legacy != null) {
        if (_cached == null) {
          await _secrets.write(persistSessionKey, legacy);
          final String? check = await _secrets.read(persistSessionKey);
          if (check != legacy) throw StateError('secure copy did not verify');
          _cached = legacy;
        }
        // The secure copy is authoritative from here on; the plaintext copy goes.
        await _prefs.remove(persistSessionKey);
      }
    } catch (_) {
      _secure = false;
      _cached = _prefs.getString(persistSessionKey);
    }
  }

  @override
  Future<bool> hasAccessToken() async => _cached != null;

  @override
  Future<String?> accessToken() async => _cached;

  @override
  Future<void> removePersistedSession() async {
    _cached = null;
    if (_secure) {
      try {
        await _secrets.delete(persistSessionKey);
      } catch (_) {
        // Nothing to delete or keystore unavailable; the in-memory copy is already gone.
      }
    }
    await _prefs.remove(persistSessionKey);
  }

  @override
  Future<void> persistSession(String persistSessionString) async {
    _cached = persistSessionString;
    if (_secure) {
      try {
        await _secrets.write(persistSessionKey, persistSessionString);
        return;
      } catch (_) {
        _secure = false;
      }
    }
    await _prefs.setString(persistSessionKey, persistSessionString);
  }
}
