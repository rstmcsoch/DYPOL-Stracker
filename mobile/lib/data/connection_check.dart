import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/config.dart';

/// Which Supabase project this build points at, and whether that project answers.
///
/// The app and the website share accounts only when both use the *same* project URL and the
/// anon key that belongs to it. If a build picks up a different URL — a copy-paste slip in
/// the repository secrets, a leftover from another project — every sign-in attempt is
/// rejected with "Invalid login credentials", which looks exactly like a wrong password.
///
/// This module answers the only question that separates those two cases:
/// *is this APK talking to the project I think it is?*
///
/// `GET {url}/auth/v1/settings` is public (it only reports which providers are enabled), so
/// it proves reachability and key validity without a password and without any secret.

/// `https://tkggckwksoatbswrebpu.supabase.co` -> `tkggckwksoatbswrebpu`.
///
/// Returns the bare host when the URL is not a Supabase host, and an empty string when the
/// build has no URL at all.
String projectRefFrom(String url) {
  final String trimmed = url.trim();
  if (trimmed.isEmpty) return '';
  Uri? uri;
  try {
    uri = Uri.tryParse(trimmed);
  } on FormatException {
    return '';
  }
  final String host = uri?.host ?? '';
  if (host.isEmpty) return '';
  final int dot = host.indexOf('.');
  return dot <= 0 ? host : host.substring(0, dot);
}

/// Human-readable host, e.g. `tkggckwksoatbswrebpu.supabase.co`.
String projectHostFrom(String url) {
  try {
    return Uri.tryParse(url.trim())?.host ?? '';
  } on FormatException {
    return '';
  }
}

enum KeyVerdict {
  /// The project answered and accepted the key in this build.
  accepted,

  /// The project answered but rejected the key — it belongs to a different project.
  rejected,

  /// No usable answer (offline, DNS, timeout, wrong host).
  unknown,
}

class ConnectionReport {
  const ConnectionReport({
    required this.host,
    required this.projectRef,
    required this.reachable,
    required this.verdict,
    this.statusCode,
    this.serverMessage = '',
    this.latency,
    this.autoConfirmsEmail,
    this.signupsEnabled,
  });

  final String host;
  final String projectRef;
  final bool reachable;
  final KeyVerdict verdict;
  final int? statusCode;
  final String serverMessage;
  final Duration? latency;

  /// True when the project confirms new accounts automatically (`mailer_autoconfirm`).
  final bool? autoConfirmsEmail;

  /// False when the project has sign-ups switched off.
  final bool? signupsEnabled;

  bool get keyAccepted => verdict == KeyVerdict.accepted;

  /// One line that can be shown under a sign-in error.
  String get headline {
    if (projectRef.isEmpty) return 'This build has no project address.';
    if (!reachable) return 'Cannot reach $host from this phone.';
    if (keyAccepted) return 'Connected to project $projectRef.';
    if (verdict == KeyVerdict.unknown) {
      return 'Project $projectRef answered with HTTP ${statusCode ?? '?'}, so it could not be checked.';
    }
    return 'The key in this build does not belong to project $projectRef.';
  }

  /// What the owner should do next, in plain words.
  String get advice {
    if (projectRef.isEmpty) {
      return 'The build was made without a project address, so it cannot sign anyone in. '
          'Rebuild with the SUPABASE_URL and SUPABASE_ANON_KEY repository secrets.';
    }
    if (!reachable) {
      return 'Check the phone is online. If other apps load fine, the project address in the '
          'build ($host) may be wrong.';
    }
    if (verdict == KeyVerdict.unknown) {
      return 'The address resolved, but the project refused the request in a way that does not '
          'prove anything about the key. Open the address in a browser: a 404 there means '
          'SUPABASE_URL is not a project URL (it should look like '
          'https://<project-ref>.supabase.co). Fix the secret, then rebuild.';
    }
    if (!keyAccepted) {
      return 'The address is right but the key is for another project, so the account you use on '
          'the website is invisible here. Fix: make SUPABASE_ANON_KEY and SUPABASE_URL in the '
          'repository secrets come from the same project, then rebuild.';
    }
    return 'Both values are correct, so a rejected password is a real password problem for this '
        'project: use “Forgot password?” on the sign-in page, then sign in with the new one.';
  }

  /// Compact block for the details sheet.
  String get report {
    final StringBuffer buffer = StringBuffer()
      ..writeln('Project ref: $projectRef')
      ..writeln('Host: ${host.isEmpty ? '—' : host}')
      ..writeln('Reachable: ${reachable ? 'yes' : 'no'}'
          '${latency == null ? '' : ' (${latency!.inMilliseconds} ms)'}');
    if (statusCode != null) buffer.writeln('HTTP status: $statusCode');
    if (verdict == KeyVerdict.accepted) buffer.writeln('Key: accepted by this project');
    if (verdict == KeyVerdict.rejected) buffer.writeln('Key: rejected by this project');
    if (autoConfirmsEmail != null) {
      buffer.writeln('Email confirmation required: ${autoConfirmsEmail! ? 'no' : 'yes'}');
    }
    if (signupsEnabled != null) {
      buffer.writeln('New sign-ups: ${signupsEnabled! ? 'allowed' : 'disabled'}');
    }
    if (serverMessage.trim().isNotEmpty) buffer.writeln('Server said: ${serverMessage.trim()}');
    return buffer.toString().trimRight();
  }
}

/// Asks the configured project which providers it has enabled. Never sends a password and
/// never sends a user token — only the public anon key the app already ships.
Future<ConnectionReport> checkConnection({
  http.Client? client,
  Duration timeout = const Duration(seconds: 12),
  String? url,
  String? anonKey,
}) async {
  final String base = (url ?? AppConfig.supabaseUrl).trim();
  final String key = (anonKey ?? AppConfig.supabaseAnonKey).trim();

  final String host = projectHostFrom(base);
  final String ref = projectRefFrom(base);

  if (base.isEmpty || host.isEmpty) {
    return ConnectionReport(
      host: host,
      projectRef: ref,
      reachable: false,
      verdict: KeyVerdict.unknown,
    );
  }

  final http.Client httpClient = client ?? http.Client();
  final Stopwatch clock = Stopwatch()..start();
  try {
    final http.Response response = await httpClient
        .get(
          Uri.parse('${base.replaceAll(RegExp(r'/+$'), '')}/auth/v1/settings'),
          headers: <String, String>{
            'apikey': key,
            'Authorization': 'Bearer $key',
            'Accept': 'application/json',
          },
        )
        .timeout(timeout);
    clock.stop();

    final String body = response.body;
    final bool ok = response.statusCode >= 200 && response.statusCode < 300;

    Map<String, dynamic> json = <String, dynamic>{};
    if (ok) {
      try {
        final Object? parsed = jsonDecode(body);
        if (parsed is Map) json = Map<String, dynamic>.from(parsed);
      } on FormatException {
        // A non-JSON body still proves the host answered; fields stay unknown.
      }
    }

    return ConnectionReport(
      host: host,
      projectRef: ref,
      reachable: true,
      verdict: ok
          ? KeyVerdict.accepted
          : (response.statusCode == 401 || response.statusCode == 403
              ? KeyVerdict.rejected
              : KeyVerdict.unknown),
      statusCode: response.statusCode,
      serverMessage: _messageFrom(body),
      latency: clock.elapsed,
      autoConfirmsEmail: json['mailer_autoconfirm'] is bool
          ? json['mailer_autoconfirm'] as bool
          : null,
      signupsEnabled:
          json['disable_signup'] is bool ? !(json['disable_signup'] as bool) : null,
    );
  } catch (error) {
    clock.stop();
    return ConnectionReport(
      host: host,
      projectRef: ref,
      reachable: false,
      verdict: KeyVerdict.unknown,
      serverMessage: _shortError(error),
      latency: clock.elapsed,
    );
  } finally {
    if (client == null) httpClient.close();
  }
}

String _messageFrom(String body) {
  if (body.trim().isEmpty) return '';
  try {
    final Object? parsed = jsonDecode(body);
    if (parsed is Map) {
      for (final String field in <String>['msg', 'message', 'error_description', 'error']) {
        final Object? value = parsed[field];
        if (value is String && value.trim().isNotEmpty) return value;
      }
    }
  } on FormatException {
    // Not JSON: fall through to a trimmed snippet.
  }
  return body.length > 160 ? '${body.substring(0, 160)}…' : body;
}

String _shortError(Object error) {
  final String text = error.toString();
  if (text.contains('TimeoutException')) return 'The request timed out.';
  if (text.contains('SocketException') || text.contains('Failed host lookup')) {
    return 'No route to the server (offline, DNS or wrong address).';
  }
  return text.length > 160 ? '${text.substring(0, 160)}…' : text;
}
