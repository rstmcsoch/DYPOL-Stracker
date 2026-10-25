import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Secondary action, styled like the website's outlined `secondary-button`: a bordered
/// button with an optional icon, so an action never reads as plain text.
class SecondaryButton extends StatelessWidget {
  const SecondaryButton({super.key, required this.label, required this.onPressed, this.icon, this.compact = false});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  /// Shorter and tighter, for rows of actions inside a card.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final ButtonStyle? style = compact ? _compactStyle : null;
    if (icon == null) {
      return OutlinedButton(onPressed: onPressed, style: style, child: Text(label));
    }
    return OutlinedButton.icon(
      onPressed: onPressed,
      style: style,
      icon: Icon(icon, size: compact ? 16 : 18),
      label: Text(label),
    );
  }
}

/// Destructive action (delete, remove): red outline and label, like the website's
/// `danger-button`. The caller still confirms before anything is removed.
class DangerButton extends StatelessWidget {
  const DangerButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon = Icons.delete_outline,
    this.compact = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData icon;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final Color red = context.stracker.palette.red;
    final ButtonStyle style = OutlinedButton.styleFrom(
      foregroundColor: red,
      side: BorderSide(color: red.withValues(alpha: 0.6)),
    ).merge(compact ? _compactStyle : null);
    return OutlinedButton.icon(
      onPressed: onPressed,
      style: style,
      icon: Icon(icon, size: compact ? 16 : 18),
      label: Text(label),
    );
  }
}

final ButtonStyle _compactStyle = OutlinedButton.styleFrom(
  minimumSize: const Size(0, 36),
  padding: const EdgeInsets.symmetric(horizontal: 12),
  visualDensity: VisualDensity.compact,
  tapTargetSize: MaterialTapTargetSize.padded,
);

/// The main Save button of an editor. It disables itself and reads "Saving…" while
/// [onPressed] runs, so a double tap can never write the same new item twice.
class SaveButton extends StatefulWidget {
  const SaveButton({super.key, required this.label, required this.onPressed});

  final String label;
  final Future<void> Function()? onPressed;

  @override
  State<SaveButton> createState() => _SaveButtonState();
}

class _SaveButtonState extends State<SaveButton> {
  bool _busy = false;

  Future<void> _press() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.onPressed!();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => ElevatedButton(
        onPressed: widget.onPressed == null || _busy ? null : _press,
        child: Text(_busy ? 'Saving…' : widget.label),
      );
}
