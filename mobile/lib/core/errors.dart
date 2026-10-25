import 'package:flutter/foundation.dart';

/// A user-facing failure. Messages here are safe to show: they never include tokens,
/// SQL, provider keys or stack traces.
class AppFailure implements Exception {
  const AppFailure(this.message, {this.code});

  final String message;
  final String? code;

  @override
  String toString() => message;
}

/// The untouched server wording behind [friendlyAuthError], for the "Details" line.
///
/// "Email or password is incorrect" is shown for more than one real cause (no such account
/// in *this* project, wrong password, or a key that belongs to another project), so the raw
/// message plus status code is what makes a support question answerable.
String authErrorDetail(String message, {String? statusCode}) {
  final String clean = message.trim();
  if (clean.isEmpty) {
    return statusCode == null ? 'No details from the server.' : 'No details · HTTP $statusCode';
  }
  return statusCode == null ? clean : 'HTTP $statusCode · $clean';
}

/// Mirrors `friendlyAuthError` in src/contexts/AuthContext.tsx.
String friendlyAuthError(String message) {
  final String normalized = message.toLowerCase();
  if (normalized.contains('invalid login credentials') || normalized.contains('invalid_credentials')) {
    return 'Email or password is incorrect. Please try again.';
  }
  if (normalized.contains('invalid api key') || normalized.contains('invalid_api_key')) {
    return 'This copy of Stracker cannot reach your account (key rejected). Install the '
        'latest version from the same download link.';
  }
  if (normalized.contains('user not found') || normalized.contains('user_not_found')) {
    return 'No account with that email exists here. Check the spelling, or create an account.';
  }
  if (normalized.contains('email not confirmed')) {
    return 'Confirm your email before signing in.';
  }
  if (normalized.contains('too many requests') ||
      normalized.contains('rate limit') ||
      normalized.contains('over_request_rate_limit')) {
    return 'Too many attempts. Wait a moment, then try again.';
  }
  if (normalized.contains('failed to fetch') ||
      normalized.contains('network') ||
      normalized.contains('socket') ||
      normalized.contains('connection')) {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
  return 'We could not complete that authentication request. Please try again.';
}

/// Mirrors `friendlySignUpError`: keeps the useful cases visible.
String friendlySignUpError(String message) {
  final String normalized = message.toLowerCase();
  if (normalized.contains('already registered') ||
      normalized.contains('already been registered') ||
      normalized.contains('user already exists')) {
    return 'Could not create a new account with those details. If you already use '
        'Stracker, log in or reset the password.';
  }
  if (normalized.contains('signups not allowed') || normalized.contains('signup disabled')) {
    return 'New accounts are closed for now. Sign in with an account you already have.';
  }
  if (normalized.contains('password should be') || normalized.contains('password is too short')) {
    return 'Use at least 8 characters for your password.';
  }
  if (normalized.contains('unable to validate email') || normalized.contains('invalid email')) {
    return 'That email address does not look right. Check it and try again.';
  }
  if (normalized.contains('too many requests') || normalized.contains('rate limit')) {
    return 'Too many attempts. Wait a moment, then try again.';
  }
  if (normalized.contains('failed to fetch') || normalized.contains('network')) {
    return 'Could not reach Stracker. Check your connection and try again.';
  }
  return friendlyAuthError(message);
}

/// Data-layer errors. RLS denials and offline writes must never look like success.
String friendlyDataError(Object error) {
  final String raw = error.toString();
  final String normalized = raw.toLowerCase();
  if (normalized.contains('row-level security') || normalized.contains('permission denied')) {
    return "That isn't available for your account. Sign in again if this keeps happening.";
  }
  if (normalized.contains('schema cache') ||
      normalized.contains('could not find the table') ||
      normalized.contains('does not exist')) {
    return 'That part of your notebook is not available right now. Pull down to refresh, and '
        'try again in a moment.';
  }
  if (normalized.contains('duplicate key') || normalized.contains('unique constraint')) {
    return 'That entry already exists for this chapter.';
  }
  if (normalized.contains('check constraint') || normalized.contains('violates check')) {
    return 'Some values are outside the allowed range. Check the numbers and try again.';
  }
  if (normalized.contains('jwt') || normalized.contains('invalid claim') || normalized.contains('401')) {
    return 'Your session expired. Sign in again to continue syncing.';
  }
  if (normalized.contains('failed host lookup') ||
      normalized.contains('socketexception') ||
      normalized.contains('network') ||
      normalized.contains('timeout')) {
    return 'Could not reach Stracker. Check your connection — your last change was not saved.';
  }
  return 'That change could not be saved. Please try again.';
}

/// The message to show for any caught error. [AppFailure]s carry a safe, written message;
/// anything else (a programming error, a platform exception, a raw server message) is never
/// shown as-is: the student gets a plain sentence and the details go to the debug log.
String userMessage(Object error, {String fallback = 'Something went wrong, so that was not saved. Please try again.'}) {
  if (error is AppFailure) return error.message;
  final String raw = error.toString().toLowerCase();
  if (raw.contains('socketexception') ||
      raw.contains('failed host lookup') ||
      raw.contains('clientexception') ||
      raw.contains('connection') ||
      raw.contains('timeout')) {
    return 'Could not reach Stracker. Check your connection and try again.';
  }
  return fallback;
}

/// Records an unexpected error for debugging: only where it happened, the error type and
/// a server error code (never note text, server messages or keys), and only outside
/// release builds.
void logFailure(String where, Object error, [StackTrace? stack]) {
  if (kReleaseMode) return;
  final String code = error is AppFailure && error.code != null ? ' (${error.code})' : '';
  debugPrint('Stracker $where failed: ${error.runtimeType}$code');
  // Expected failures (a refused write, no connection) need no stack; bugs do.
  if (stack != null && error is! AppFailure) debugPrint(stack.toString());
}
