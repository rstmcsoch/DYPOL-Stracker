/// A user-facing failure. Messages here are safe to show: they never include tokens,
/// SQL, provider keys or stack traces.
class AppFailure implements Exception {
  const AppFailure(this.message, {this.code});

  final String message;
  final String? code;

  @override
  String toString() => message;
}

/// Mirrors `friendlyAuthError` in src/contexts/AuthContext.tsx.
String friendlyAuthError(String message) {
  final String normalized = message.toLowerCase();
  if (normalized.contains('invalid login credentials')) {
    return 'Email or password is incorrect. Please try again.';
  }
  if (normalized.contains('email not confirmed')) {
    return 'Confirm your email before signing in.';
  }
  if (normalized.contains('too many requests')) {
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
    return 'This deployment does not allow new accounts to be created yet. Sign in with an '
        'existing account, or enable email sign-ups in Supabase Auth.';
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
    return 'Could not reach the sign-up service. Check your connection and try again.';
  }
  return friendlyAuthError(message);
}

/// Data-layer errors. RLS denials and offline writes must never look like success.
String friendlyDataError(Object error) {
  final String raw = error.toString();
  final String normalized = raw.toLowerCase();
  if (normalized.contains('row-level security') || normalized.contains('permission denied')) {
    return 'That record is not available to your account. Sign in again if this keeps happening.';
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
