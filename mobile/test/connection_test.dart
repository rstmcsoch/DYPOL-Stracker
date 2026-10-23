import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/errors.dart';
import 'package:stracker/data/connection_check.dart';

void main() {
  test('the project ref is the first label of the Supabase host', () {
    expect(projectRefFrom('https://tkggckwksoatbswrebpu.supabase.co'), 'tkggckwksoatbswrebpu');
    expect(projectRefFrom('https://tkggckwksoatbswrebpu.supabase.co/'), 'tkggckwksoatbswrebpu');
    expect(projectRefFrom('  https://abc123.supabase.co  '), 'abc123');
    expect(projectHostFrom('https://abc123.supabase.co/auth/v1'),
        'abc123.supabase.co');
  });

  test('a missing or unusable address never becomes a fake project', () {
    expect(projectRefFrom(''), '');
    expect(projectRefFrom('   '), '');
    expect(projectRefFrom('not a url'), '');
    expect(projectHostFrom(''), '');
  });

  test('the report separates "wrong project" from "wrong password"', () {
    const ConnectionReport rejected = ConnectionReport(
      host: 'tkggckwksoatbswrebpu.supabase.co',
      projectRef: 'tkggckwksoatbswrebpu',
      reachable: true,
      verdict: KeyVerdict.rejected,
      statusCode: 401,
      serverMessage: 'Invalid API key',
    );
    expect(rejected.keyAccepted, isFalse);
    expect(rejected.headline, contains('does not belong to project'));
    expect(rejected.advice, contains('SUPABASE_ANON_KEY'));
    expect(rejected.report, contains('HTTP status: 401'));
    expect(rejected.report, contains('Invalid API key'));

    const ConnectionReport accepted = ConnectionReport(
      host: 'tkggckwksoatbswrebpu.supabase.co',
      projectRef: 'tkggckwksoatbswrebpu',
      reachable: true,
      verdict: KeyVerdict.accepted,
      statusCode: 200,
      latency: Duration(milliseconds: 84),
      autoConfirmsEmail: true,
      signupsEnabled: true,
    );
    expect(accepted.headline, 'Connected to project tkggckwksoatbswrebpu.');
    expect(accepted.advice, contains('Forgot password'));
    expect(accepted.report, contains('84 ms'));

    const ConnectionReport offline = ConnectionReport(
      host: 'tkggckwksoatbswrebpu.supabase.co',
      projectRef: 'tkggckwksoatbswrebpu',
      reachable: false,
      verdict: KeyVerdict.unknown,
    );
    expect(offline.headline, contains('Cannot reach'));
    expect(offline.advice, contains('online'));

    const ConnectionReport unbuilt = ConnectionReport(
      host: '',
      projectRef: '',
      reachable: false,
      verdict: KeyVerdict.unknown,
    );
    expect(unbuilt.headline, contains('no project address'));
    expect(unbuilt.advice, contains('SUPABASE_URL'));
  });

  test('an unexpected HTTP status is not blamed on the key', () {
    const ConnectionReport odd = ConnectionReport(
      host: 'example.com',
      projectRef: 'example',
      reachable: true,
      verdict: KeyVerdict.unknown,
      statusCode: 404,
    );
    expect(odd.headline, contains('HTTP 404'));
    expect(odd.headline, isNot(contains('does not belong')));
    expect(odd.advice, contains('SUPABASE_URL'));
  });

  test('the detail line keeps the server wording and the status code', () {
    expect(
      authErrorDetail('Invalid login credentials', statusCode: '400'),
      'HTTP 400 · Invalid login credentials',
    );
    expect(authErrorDetail('Invalid API key'), 'Invalid API key');
    expect(authErrorDetail('', statusCode: '401'), 'No details · HTTP 401');
    expect(authErrorDetail(''), 'No details from the server.');
  });

  test('the friendly message distinguishes the reasons the server gives', () {
    expect(friendlyAuthError('Invalid login credentials'),
        'Email or password is incorrect. Please try again.');
    expect(friendlyAuthError('Invalid API key'), contains('key rejected'));
    expect(friendlyAuthError('Email not confirmed'), contains('Confirm your email'));
    expect(friendlyAuthError('User not found'), contains('No account with that email'));
    expect(friendlyAuthError('over_request_rate_limit'), contains('Too many attempts'));
  });
}
