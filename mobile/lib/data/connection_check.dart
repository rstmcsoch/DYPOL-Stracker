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

  /// One plain sentence for the student. No product names, no project ids.
  String get headline {
    if (projectRef.isEmpty) return 'This copy of Stracker is not linked to your account yet.';
    if (!reachable) return 'This phone cannot reach Stracker right now.';
    if (keyAccepted) return 'Connected. This phone can reach your account.';
    if (verdict == KeyVerdict.unknown) {
      return 'The connection answered in an unexpected way, so it could not be checked.';
    }
    return 'This copy of Stracker is looking in the wrong place, so your account is invisible to it.';
  }

  /// What to do next, in plain words.
  String get advice {
    if (projectRef.isEmpty) {
      return 'Nothing on this phone can fix that: the app was installed without its connection '
          'details. Get the current version from the same link you used before.';
    }
    if (!reachable) {
      return 'Check that this phone is online — mobile data or Wi-Fi — then try again. '
          'If other apps load fine, the problem is on our side; try again later.';
    }
    if (!keyAccepted && verdict == KeyVerdict.rejected) {
      return 'A fresh install from the latest download fixes this. If it keeps happening, send '
          'the details below to support.';
    }
    if (!keyAccepted) {
      return 'Try again in a moment. If it persists, send the details below to support.';
    }
    return 'Your password is the only thing left to check: use “Forgot password?” on the '
        'sign-in page, set a new one, and sign in with it.';
  }

  /// Technical block, hidden by default. Only shown when someone taps "details", or copied
  /// when support asks for it — it is never part of the normal screens.
  String get technicalDetails {
    final StringBuffer buffer = StringBuffer()
      ..writeln('Stracker connection report')
      ..writeln('Project ref: $projectRef')
      ..writeln('Host: ${host.isEmpty ? '—' : host}')
      ..writeln('Reachable: ${reachable ? 'yes' : 'no'}'
          '${latency == null ? '' : ' (${latency!.inMilliseconds} ms)'}');
    if (statusCode != null) buffer.writeln('HTTP status: $statusCode');
    if (verdict == KeyVerdict.accepted) buffer.writeln('Key: accepted');
    if (verdict == KeyVerdict.rejected) buffer.writeln('Key: rejected');
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
