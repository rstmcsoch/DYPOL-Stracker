import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stracker/core/secure_session_storage.dart';

class _MemorySecrets implements SecretStore {
  final Map<String, String> values = <String, String>{};
  bool broken = false;

  @override
  Future<String?> read(String key) async {
    if (broken) throw StateError('keystore unavailable');
    return values[key];
  }

  @override
  Future<void> write(String key, String value) async {
    if (broken) throw StateError('keystore unavailable');
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    if (broken) throw StateError('keystore unavailable');
    values.remove(key);
  }
}

void main() {
  const String key = 'sb-tkggckwksoatbswrebpu-auth-token';

  test('session key matches supabase_flutter default', () {
    expect(supabaseSessionKey('https://tkggckwksoatbswrebpu.supabase.co'), key);
  });

  test('an old SharedPreferences session is moved once and the plaintext copy deleted', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{key: '{"session":1}'});
    final _MemorySecrets secrets = _MemorySecrets();
    final SecureSessionStorage storage = SecureSessionStorage(persistSessionKey: key, secrets: secrets);
    await storage.initialize();
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    expect(await storage.hasAccessToken(), isTrue);
    expect(await storage.accessToken(), '{"session":1}');
    expect(secrets.values[key], '{"session":1}');
    expect(prefs.containsKey(key), isFalse);
    expect(storage.usingFallback, isFalse);
  });

  test('new sessions are written only to secure storage and removed on sign-out', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final _MemorySecrets secrets = _MemorySecrets();
    final SecureSessionStorage storage = SecureSessionStorage(persistSessionKey: key, secrets: secrets);
    await storage.initialize();
    expect(await storage.hasAccessToken(), isFalse);
    await storage.persistSession('s2');
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    expect(secrets.values[key], 's2');
    expect(prefs.containsKey(key), isFalse);
    await storage.removePersistedSession();
    expect(secrets.values.containsKey(key), isFalse);
    expect(await storage.hasAccessToken(), isFalse);
  });

  test('a secure copy wins over a stale plaintext one, which is deleted', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{key: 'old'});
    final _MemorySecrets secrets = _MemorySecrets()..values[key] = 'new';
    final SecureSessionStorage storage = SecureSessionStorage(persistSessionKey: key, secrets: secrets);
    await storage.initialize();
    expect(await storage.accessToken(), 'new');
    expect((await SharedPreferences.getInstance()).containsKey(key), isFalse);
  });

  test('an unusable keystore keeps the existing session instead of signing out', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{key: 'legacy'});
    final _MemorySecrets secrets = _MemorySecrets()..broken = true;
    final SecureSessionStorage storage = SecureSessionStorage(persistSessionKey: key, secrets: secrets);
    await storage.initialize();
    expect(storage.usingFallback, isTrue);
    expect(await storage.accessToken(), 'legacy');
    expect((await SharedPreferences.getInstance()).getString(key), 'legacy');
  });
}
