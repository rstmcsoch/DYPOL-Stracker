import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/config.dart';
import '../../core/errors.dart';
import '../../data/data_controller.dart';

/// Local auth state. Named `AuthStatus` because `supabase_flutter` already exports
/// `AuthState` for its stream events.
class AuthStatus {
  const AuthStatus({
    this.session,
    this.initializing = true,
    this.busy = false,
    this.error,
    this.detail,
    this.recoveryMode = false,
    this.awaitingEmailConfirmation = false,
    this.misconfigured = false,
  });

  final Session? session;
  final bool initializing;
  final bool busy;
  final String? error;

  /// Raw server wording + status code behind [error], shown under "Details".
  final String? detail;

  /// The user arrived from a password-recovery link and must set a new password.
  final bool recoveryMode;

  /// Sign-up succeeded but Supabase requires email confirmation, so there is no session.
  final bool awaitingEmailConfirmation;

  /// Build-time Supabase configuration is missing; the UI explains how to build properly.
  final bool misconfigured;

  bool get signedIn => session != null;

  AuthStatus copyWith({
    Session? session,
    bool? initializing,
    bool? busy,
    Object? error = _none,
    Object? detail = _none,
    bool? recoveryMode,
    bool? awaitingEmailConfirmation,
    bool? misconfigured,
    bool clearSession = false,
  }) =>
      AuthStatus(
        session: clearSession ? null : (session ?? this.session),
        initializing: initializing ?? this.initializing,
        busy: busy ?? this.busy,
        error: error == _none ? this.error : error as String?,
        detail: detail == _none ? this.detail : detail as String?,
        recoveryMode: recoveryMode ?? this.recoveryMode,
        awaitingEmailConfirmation: awaitingEmailConfirmation ?? this.awaitingEmailConfirmation,
        misconfigured: misconfigured ?? this.misconfigured,
      );
}

const Object _none = Object();

class AuthController extends StateNotifier<AuthStatus> {
  AuthController() : super(const AuthStatus()) {
    if (!AppConfig.hasSupabaseConfig) {
      state = const AuthStatus(initializing: false, misconfigured: true);
      return;
    }
    final SupabaseClient client = Supabase.instance.client;
    _client = client;
    _subscription = client.auth.onAuthStateChange.listen(_onAuthChange);
    final Session? session = client.auth.currentSession;
    _publish(session, recovery: false);
  }

  SupabaseClient? _client;

  /// Email used for the last sign-up attempt, so the confirmation screen can resend it.
  String pendingEmail = '';
  StreamSubscription<AuthState>? _subscription;

  void _onAuthChange(AuthState event) {
    switch (event.event) {
      case AuthChangeEvent.passwordRecovery:
        state = state.copyWith(
          session: event.session,
          busy: false,
          recoveryMode: true,
          initializing: false,
        );
      case AuthChangeEvent.signedOut:
        state = const AuthStatus(initializing: false, recoveryMode: false);
      default:
        _publish(event.session, recovery: state.recoveryMode);
    }
  }

  void _publish(Session? session, {required bool recovery}) {
    SupabaseAuth.email = session?.user.email;
    SupabaseAuth.displayName =
        session?.user.userMetadata?['display_name']?.toString();
    state = state.copyWith(
      session: session,
      clearSession: session == null,
      initializing: false,
      busy: false,
      error: null,
      detail: null,
      recoveryMode: recovery,
      awaitingEmailConfirmation:
          session == null ? state.awaitingEmailConfirmation : false,
    );
  }

  Future<bool> signIn({required String email, required String password}) async {
    final SupabaseClient? client = _client;
    if (client == null) return false;
    state = state.copyWith(busy: true, error: null);
    try {
      final AuthResponse response = await client.auth.signInWithPassword(
        email: email.trim(),
        password: password,
      );
      _publish(response.session, recovery: false);
      return response.session != null;
    } on AuthException catch (error) {
      state = state.copyWith(
        busy: false,
        error: friendlyAuthError(error.message),
        detail: authErrorDetail(error.message, statusCode: error.statusCode),
      );
      return false;
    } catch (error) {
      state = state.copyWith(
        busy: false,
        error: friendlyAuthError('$error'),
        detail: authErrorDetail('$error'),
      );
      return false;
    }
  }

  /// Returns true when a session exists immediately. When Supabase requires email
  /// confirmation the state switches to [AuthStatus.awaitingEmailConfirmation].
  Future<bool> signUp({
    required String email,
    required String password,
    required String displayName,
  }) async {
    final SupabaseClient? client = _client;
    if (client == null) return false;
    state = state.copyWith(busy: true, error: null, awaitingEmailConfirmation: false);
    pendingEmail = email.trim();
    try {
      final AuthResponse response = await client.auth.signUp(
        email: email.trim(),
        password: password,
        data: <String, dynamic>{'display_name': displayName.trim()},
        emailRedirectTo: AppConfig.authRedirectUrl,
      );
      final bool hasSession = response.session != null;
      if (hasSession) {
        _publish(response.session, recovery: false);
      } else {
        state = state.copyWith(
          busy: false,
          initializing: false,
          awaitingEmailConfirmation: true,
        );
      }
      return hasSession;
    } on AuthException catch (error) {
      state = state.copyWith(
        busy: false,
        error: friendlyAuthError(error.message),
        detail: authErrorDetail(error.message, statusCode: error.statusCode),
      );
      return false;
    } catch (error) {
      state = state.copyWith(
        busy: false,
        error: friendlyAuthError('$error'),
        detail: authErrorDetail('$error'),
      );
      return false;
    }
  }

  Future<void> resendConfirmation(String email) async {
    final SupabaseClient? client = _client;
    if (client == null) return;
    state = state.copyWith(busy: true, error: null);
    try {
      await client.auth.resend(email: email.trim(), type: OtpType.signup);
      state = state.copyWith(busy: false);
    } on AuthException catch (error) {
      state = state.copyWith(
        busy: false,
        error: friendlyAuthError(error.message),
        detail: authErrorDetail(error.message, statusCode: error.statusCode),
      );
    } catch (error) {
      state = state.copyWith(
        busy: false,
        error: friendlyAuthError('$error'),
        detail: authErrorDetail('$error'),
      );
    }
  }

  Future<bool> sendPasswordReset(String email) async {
    final SupabaseClient? client = _client;
    if (client == null) return false;
    state = state.copyWith(busy: true, error: null);
    try {
      await client.auth.resetPasswordForEmail(
        email.trim(),
        redirectTo: AppConfig.authRedirectUrl,
      );
      state = state.copyWith(busy: false);
      return true;
    } on AuthException catch (error) {
      state = state.copyWith(
        busy: false,
        error: friendlyAuthError(error.message),
        detail: authErrorDetail(error.message, statusCode: error.statusCode),
      );
      return false;
    } catch (error) {
      state = state.copyWith(
        busy: false,
        error: friendlyAuthError('$error'),
        detail: authErrorDetail('$error'),
      );
      return false;
    }
  }

  Future<bool> updatePassword(String password) async {
    final SupabaseClient? client = _client;
    if (client == null) return false;
    state = state.copyWith(busy: true, error: null);
    try {
      final UserResponse response =
          await client.auth.updateUser(UserAttributes(password: password));
      state = state.copyWith(busy: false, recoveryMode: false);
      if (response.user == null) return false;
      return true;
    } on AuthException catch (error) {
      state = state.copyWith(
        busy: false,
        error: friendlyAuthError(error.message),
        detail: authErrorDetail(error.message, statusCode: error.statusCode),
      );
      return false;
    } catch (error) {
      state = state.copyWith(
        busy: false,
        error: friendlyAuthError('$error'),
        detail: authErrorDetail('$error'),
      );
      return false;
    }
  }

  Future<void> signOut() async {
    final SupabaseClient? client = _client;
    if (client == null) return;
    state = state.copyWith(busy: true, error: null);
    try {
      await client.auth.signOut();
    } catch (_) {
      // A failed network sign-out still clears the local session below.
    }
    state = const AuthStatus(initializing: false);
  }

  void clearError() => state = state.copyWith(error: null, detail: null);

  void leaveRecovery() => state = state.copyWith(recoveryMode: false);

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}

final StateNotifierProvider<AuthController, AuthStatus> authControllerProvider =
    StateNotifierProvider<AuthController, AuthStatus>((Ref ref) => AuthController());
