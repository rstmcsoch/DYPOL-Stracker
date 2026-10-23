import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/theme/app_theme.dart';
import '../../core/validators.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/data_controller.dart';
import 'auth_controller.dart';
import 'connection_sheet.dart';

/// Sign-in, sign-up and password reset, styled as pages of the same notebook. Inputs keep
/// the keyboard-aware layout, validation mirrors the website's rules, and every failure is
/// shown with the friendly message from the shared error mapping.
class AuthFlow extends ConsumerStatefulWidget {
  const AuthFlow({super.key, this.mode = 'login'});
  final String mode;

  @override
  ConsumerState<AuthFlow> createState() => _AuthFlowState();
}

class _AuthFlowState extends ConsumerState<AuthFlow> {
  late String _mode = widget.mode;

  /// Which project this build signs in against — the first thing to compare when the same
  /// email and password work on the website but not here.
  @override
  Widget build(BuildContext context) {
    final AuthStatus status = ref.watch(authControllerProvider);
    final StrackerColors colors = context.stracker;

    if (status.awaitingEmailConfirmation) {
      return _AuthShell(
        title: 'Confirm your email',
        subtitle: 'One more step',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            InfoBanner(
              'We sent a confirmation link to your address. Open it, then come back and sign in. '
              'The link returns you to Stracker on this device.',
              tone: PillTone.good,
              icon: Icons.mark_email_read_outlined,
            ),
            const SizedBox(height: 14),
            OutlinedButton(
              onPressed: status.busy
                  ? null
                  : () async {
                      await ref.read(authControllerProvider.notifier).resendConfirmation(
                            ref.read(authControllerProvider.notifier).pendingEmail,
                          );
                      if (context.mounted) showToast(context, 'Confirmation email sent again.');
                    },
              child: const Text('Resend confirmation email'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => ref.read(authControllerProvider.notifier).clearError(),
              child: const Text('Back to sign in'),
            ),
          ],
        ),
      );
    }

    return _AuthShell(
      title: _title,
      subtitle: _subtitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (status.error != null) ...<Widget>[
            ErrorNotice(status.error!),
            const SizedBox(height: 2),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => showConnectionSheet(context),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  minimumSize: const Size(0, 30),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Still not working? Check the connection'),
              ),
            ),
            const SizedBox(height: 6),
          ],
          switch (_mode) {
            'signup' => _SignUpForm(onSwitch: _switchMode, busy: status.busy),
            'forgot' => _ForgotForm(onSwitch: _switchMode, busy: status.busy),
            _ => _LoginForm(onSwitch: _switchMode, busy: status.busy),
          },

        ],
      ),
    );
  }

  String get _title => switch (_mode) {
        'signup' => 'Create your notebook',
        'forgot' => 'Reset your password',
        _ => 'Welcome back',
      };

  String get _subtitle => switch (_mode) {
        'signup' => 'Stracker by DYPOL LABS',
        'forgot' => 'We send a link, never a password',
        _ => 'Stracker by DYPOL LABS',
      };

  void _switchMode(String mode) {
    ref.read(authControllerProvider.notifier).clearError();
    setState(() => _mode = mode);
  }
}

class _AuthShell extends StatelessWidget {
  const _AuthShell({required this.title, required this.subtitle, required this.child});

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Scaffold(
      backgroundColor: colors.palette.bg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Center(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(20),
                      child: Image.asset('assets/brand/logo.png', width: 74, height: 74),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: 'PatrickHand',
                      fontSize: 33,
                      height: 1.1,
                      color: colors.palette.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle.toUpperCase(),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: colors.muted,
                          letterSpacing: 2,
                        ),
                  ),
                  const SizedBox(height: 20),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: colors.palette.paper,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: colors.palette.line),
                    ),
                    child: child,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'DYPOL LABS',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: colors.muted,
                          letterSpacing: 0.6,
                        ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _LoginForm extends ConsumerStatefulWidget {
  const _LoginForm({required this.onSwitch, required this.busy});
  final ValueChanged<String> onSwitch;
  final bool busy;

  @override
  ConsumerState<_LoginForm> createState() => _LoginFormState();
}

class _LoginFormState extends ConsumerState<_LoginForm> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  String? _emailError;
  String? _passwordError;
  bool _obscure = true;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final String? emailError = Validators.email(_email.text);
    final String? passwordError = (_password.text.isEmpty) ? 'Enter your password.' : null;
    setState(() {
      _emailError = emailError;
      _passwordError = passwordError;
    });
    if (emailError != null || passwordError != null) return;
    await ref.read(authControllerProvider.notifier).signIn(
          email: _email.text,
          password: _password.text,
        );
  }

  @override
  Widget build(BuildContext context) {
    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppField(
            label: 'Email',
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            textCapitalization: TextCapitalization.none,
            hint: 'you@example.com',
            error: _emailError,
            required: true,
            autofillHints: const <String>[AutofillHints.email],
          ),
          AppField(
            label: 'Password',
            controller: _password,
            obscure: _obscure,
            error: _passwordError,
            required: true,
            autofillHints: const <String>[AutofillHints.password],
            suffix: IconButton(
              tooltip: _obscure ? 'Show password' : 'Hide password',
              icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 18),
              onPressed: () => setState(() => _obscure = !_obscure),
            ),
          ),
          ElevatedButton(
            onPressed: widget.busy ? null : _submit,
            child: Text(widget.busy ? 'Signing in…' : 'Sign in'),
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              TextButton(
                onPressed: widget.busy ? null : () => widget.onSwitch('signup'),
                child: const Text('Create account'),
              ),
              TextButton(
                onPressed: widget.busy ? null : () => widget.onSwitch('forgot'),
                child: const Text('Forgot password?'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SignUpForm extends ConsumerStatefulWidget {
  const _SignUpForm({required this.onSwitch, required this.busy});
  final ValueChanged<String> onSwitch;
  final bool busy;

  @override
  ConsumerState<_SignUpForm> createState() => _SignUpFormState();
}

class _SignUpFormState extends ConsumerState<_SignUpForm> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  String? _nameError;
  String? _emailError;
  String? _passwordError;
  String? _confirmError;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final String? nameError = Validators.displayName(_name.text);
    final String? emailError = Validators.email(_email.text);
    final String? passwordError = Validators.password(_password.text);
    final String? confirmError = Validators.confirmPassword(_confirm.text, _password.text);
    setState(() {
      _nameError = nameError;
      _emailError = emailError;
      _passwordError = passwordError;
      _confirmError = confirmError;
    });
    if (nameError != null || emailError != null || passwordError != null || confirmError != null) {
      return;
    }
    await ref.read(authControllerProvider.notifier).signUp(
          email: _email.text,
          password: _password.text,
          displayName: _name.text,
        );
  }

  @override
  Widget build(BuildContext context) {
    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppField(
            label: 'Your name',
            controller: _name,
            hint: 'Your full name',
            error: _nameError,
            required: true,
            textCapitalization: TextCapitalization.words,
            autofillHints: const <String>[AutofillHints.name],
          ),
          AppField(
            label: 'Email',
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            textCapitalization: TextCapitalization.none,
            error: _emailError,
            required: true,
            autofillHints: const <String>[AutofillHints.email],
          ),
          AppField(
            label: 'Password',
            controller: _password,
            obscure: true,
            helper: 'At least ${Validators.minPasswordLength} characters.',
            error: _passwordError,
            required: true,
          ),
          AppField(
            label: 'Confirm password',
            controller: _confirm,
            obscure: true,
            error: _confirmError,
            required: true,
          ),
          ElevatedButton(
            onPressed: widget.busy ? null : _submit,
            child: Text(widget.busy ? 'Creating…' : 'Create account'),
          ),
          const SizedBox(height: 4),
          TextButton(
            onPressed: widget.busy ? null : () => widget.onSwitch('login'),
            child: const Text('I already have an account'),
          ),
        ],
      ),
    );
  }
}

class _ForgotForm extends ConsumerStatefulWidget {
  const _ForgotForm({required this.onSwitch, required this.busy});
  final ValueChanged<String> onSwitch;
  final bool busy;

  @override
  ConsumerState<_ForgotForm> createState() => _ForgotFormState();
}

class _ForgotFormState extends ConsumerState<_ForgotForm> {
  final TextEditingController _email = TextEditingController();
  String? _emailError;
  bool _sent = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final String? error = Validators.email(_email.text);
    setState(() => _emailError = error);
    if (error != null) return;
    final bool ok =
        await ref.read(authControllerProvider.notifier).sendPasswordReset(_email.text);
    if (ok && mounted) setState(() => _sent = true);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (_sent) ...<Widget>[
          InfoBanner(
            'If an account exists for ${_email.text.trim()}, a reset link is on its way. Open it on this '
            'device to set a new password.',
            tone: PillTone.good,
            icon: Icons.outgoing_mail,
          ),
          const SizedBox(height: 12),
        ],
        AppField(
          label: 'Email',
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          textCapitalization: TextCapitalization.none,
          error: _emailError,
          required: true,
        ),
        ElevatedButton(
          onPressed: widget.busy ? null : _submit,
          child: Text(_sent ? 'Send another link' : 'Send reset link'),
        ),
        const SizedBox(height: 4),
        TextButton(
          onPressed: () => widget.onSwitch('login'),
          child: const Text('Back to sign in'),
        ),
      ],
    );
  }
}

/// Shown when the app opens from a recovery deep link. Sets a new password for the current
/// session and then returns to the notebook.
class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key});

  @override
  ConsumerState<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  String? _passwordError;
  String? _confirmError;
  bool _done = false;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AuthStatus status = ref.watch(authControllerProvider);
    return _AuthShell(
      title: 'Choose a new password',
      subtitle: 'Password recovery',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (status.error != null) ...<Widget>[
            ErrorNotice(status.error!),
            const SizedBox(height: 12),
          ],
          if (_done)
            InfoBanner(
              'Password updated. Your notebooks are unlocked.',
              tone: PillTone.good,
              icon: Icons.check_circle_outline,
            ),
          const SizedBox(height: 6),
          AppField(
            label: 'New password',
            controller: _password,
            obscure: true,
            helper: 'At least ${Validators.minPasswordLength} characters.',
            error: _passwordError,
            required: true,
          ),
          AppField(
            label: 'Repeat password',
            controller: _confirm,
            obscure: true,
            error: _confirmError,
            required: true,
          ),
          ElevatedButton(
            onPressed: status.busy
                ? null
                : () async {
                    final String? passwordError = Validators.password(_password.text);
                    final String? confirmError =
                        Validators.confirmPassword(_confirm.text, _password.text);
                    setState(() {
                      _passwordError = passwordError;
                      _confirmError = confirmError;
                    });
                    if (passwordError != null || confirmError != null) return;
                    final bool ok = await ref
                        .read(authControllerProvider.notifier)
                        .updatePassword(_password.text);
                    if (ok && mounted) {
                      setState(() => _done = true);
                      await Future<void>.delayed(const Duration(milliseconds: 600));
                      if (mounted) ref.read(authControllerProvider.notifier).leaveRecovery();
                    }
                  },
            child: Text(status.busy ? 'Saving…' : 'Set new password'),
          ),
          const SizedBox(height: 4),
          TextButton(
            onPressed: () => ref.read(authControllerProvider.notifier).leaveRecovery(),
            child: const Text('Back to the app'),
          ),
        ],
      ),
    );
  }
}

/// Change-password sheet used from Profile and Settings. Same rule as the website.
Future<void> openChangePasswordSheet(BuildContext context, WidgetRef ref) async {
  final TextEditingController password = TextEditingController();
  final TextEditingController confirm = TextEditingController();
  String? passwordError;
  String? confirmError;

  await showAppSheet<void>(
    context,
    title: 'Change password',
    builder: (BuildContext sheetContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setSheetState) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppField(
            label: 'New password',
            controller: password,
            obscure: true,
            helper: 'At least ${Validators.minPasswordLength} characters.',
            error: passwordError,
            required: true,
          ),
          AppField(
            label: 'Repeat password',
            controller: confirm,
            obscure: true,
            error: confirmError,
            required: true,
          ),
          ElevatedButton(
            onPressed: () async {
              final String? newError = Validators.password(password.text);
              final String? repeatError = Validators.confirmPassword(confirm.text, password.text);
              setSheetState(() {
                passwordError = newError;
                confirmError = repeatError;
              });
              if (newError != null || repeatError != null) return;
              final bool ok =
                  await ref.read(authControllerProvider.notifier).updatePassword(password.text);
              if (!ok) {
                if (sheetContext.mounted) {
                  showToast(
                    sheetContext,
                    ref.read(authControllerProvider).error ?? 'The password could not be changed.',
                    error: true,
                  );
                }
                return;
              }
              if (sheetContext.mounted) Navigator.of(sheetContext).pop();
              if (context.mounted) showToast(context, 'Password changed.');
            },
            child: const Text('Update password'),
          ),
          const SizedBox(height: 6),
          Text(
            'You stay signed in on this phone with the new password.',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: context.stracker.muted),
          ),
        ],
      ),
    ),
  );
  password.dispose();
  confirm.dispose();
}

/// Shown only if a build ships without its connection details: no developer instructions,
/// just an honest message and what the person can actually do.
class ConfigMissingPage extends StatelessWidget {
  const ConfigMissingPage({super.key});

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Scaffold(
      backgroundColor: colors.palette.bg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Stracker is not set up', style: Theme.of(context).textTheme.headlineLarge),
                  const SizedBox(height: 8),
                  Text(
                    'This copy of the app was installed without its connection details, so it '
                    'cannot open your notebook.',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Download the current version again from the same link you used before and '
                    'install it over this one. Your account and your pages are safe either way.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.inkSoft),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
