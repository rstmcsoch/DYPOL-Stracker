import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../theme/app_theme.dart';
import 'wandering_eyes.dart';

/// Confirmation for destructive or hard-to-undo actions. Returns false on dismiss.
Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'Delete',
  String cancelLabel = 'Cancel',
  bool destructive = true,
}) async {
  final StrackerColors colors = context.stracker;
  final bool? result = await showDialog<bool>(
    context: context,
    builder: (BuildContext dialogContext) => AlertDialog(
      backgroundColor: colors.palette.paper,
      title: Text(title, style: Theme.of(dialogContext).textTheme.headlineSmall),
      content: Text(message, style: Theme.of(dialogContext).textTheme.bodyMedium),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: Text(cancelLabel),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: destructive ? colors.palette.red : colors.palette.accent,
          ),
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}

/// Modal sheet used for every form. It is scroll-controlled, respects the keyboard inset
/// and caps its height so long forms stay usable in landscape.
Future<T?> showAppSheet<T>(
  BuildContext context, {
  required String title,
  required WidgetBuilder builder,
  double maxHeightFactor = 0.92,
  VoidCallback? onDisposed,
}) {
  final StrackerColors colors = context.stracker;
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: colors.palette.paper,
    builder: (BuildContext sheetContext) {
      final double viewport = MediaQuery.sizeOf(sheetContext).height;
      return _DisposeWith(
        onDisposed: onDisposed,
        child: Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheetContext).bottom),
          child: Center(
            child: ConstrainedBox(
              // A sheet on a tablet should read like a card, not stretch to 1200 px.
              constraints: BoxConstraints(
                maxHeight: viewport * maxHeightFactor,
                maxWidth: 620,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 8, 4),
                    child: Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(title, style: Theme.of(sheetContext).textTheme.headlineSmall),
                        ),
                        IconButton(
                          tooltip: 'Close',
                          onPressed: () => Navigator.of(sheetContext).maybePop(),
                          icon: const Icon(Icons.close, size: 20),
                        ),
                      ],
                    ),
                  ),
                  Divider(height: 1, color: colors.palette.line),
                  Flexible(
                    child: SingleChildScrollView(
                      padding: EdgeInsets.fromLTRB(
                        16,
                        14,
                        16,
                        16 + MediaQuery.paddingOf(sheetContext).bottom,
                      ),
                      child: builder(sheetContext),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}

/// A small window centred over a blurred, dimmed screen, sized to its content: the same
/// look as the notebook search. For quick single-field edits (such as the display name)
/// that would otherwise open the tall form sheet. Closes on the X, a tap outside it and
/// Android back. [onDisposed] runs once the closing animation has finished.
Future<T?> showCompactDialog<T>(
  BuildContext context, {
  required String title,
  required WidgetBuilder builder,
  VoidCallback? onDisposed,
  double maxWidth = 420,
}) {
  // Like the search window it sits on the root navigator so the blur covers the whole
  // screen (sidebar and bottom tabs included); the signed-in providers are carried over.
  ProviderContainer? container;
  try {
    container = ProviderScope.containerOf(context, listen: false);
  } catch (_) {
    container = null;
  }
  return showGeneralDialog<T>(
    context: context,
    useRootNavigator: true,
    barrierDismissible: true,
    barrierLabel: 'Close',
    barrierColor: Colors.transparent,
    transitionDuration: const Duration(milliseconds: 220),
    pageBuilder: (BuildContext dialogContext, Animation<double> animation, Animation<double> secondary) {
      final Widget window = _DisposeWith(
        onDisposed: onDisposed,
        child: CompactDialogWindow(title: title, maxWidth: maxWidth, child: Builder(builder: builder)),
      );
      return container == null ? window : UncontrolledProviderScope(container: container, child: window);
    },
    transitionBuilder: (BuildContext context, Animation<double> animation, Animation<double> secondary, Widget child) {
      final CurvedAnimation curve = CurvedAnimation(parent: animation, curve: Curves.easeOutCubic);
      return Stack(
        children: <Widget>[
          // Purely visual: taps go through to the route's barrier, which closes the window.
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: curve,
                builder: (BuildContext context, Widget? _) => BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 6 * curve.value, sigmaY: 6 * curve.value),
                  child: ColoredBox(color: Colors.black.withValues(alpha: 0.30 * curve.value)),
                ),
              ),
            ),
          ),
          FadeTransition(
            opacity: curve,
            child: ScaleTransition(scale: Tween<double>(begin: 0.96, end: 1).animate(curve), child: child),
          ),
        ],
      );
    },
  );
}

/// The compact window itself: title, X and the content, no taller than it needs to be.
/// Public for tests.
class CompactDialogWindow extends StatelessWidget {
  const CompactDialogWindow({super.key, required this.title, required this.child, this.maxWidth = 420});

  final String title;
  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final MediaQueryData media = MediaQuery.of(context);
    final double width = (media.size.width * 0.9).clamp(0.0, maxWidth);
    final double available = media.size.height - media.viewInsets.bottom - media.padding.vertical - 32;
    return SafeArea(
      child: AnimatedPadding(
        duration: const Duration(milliseconds: 120),
        padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              minWidth: width,
              maxWidth: width,
              maxHeight: available < 160 ? 160 : available,
            ),
            child: Material(
              key: const ValueKey<String>('compact-dialog'),
              color: colors.palette.paper,
              elevation: 16,
              shadowColor: Colors.black54,
              clipBehavior: Clip.antiAlias,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(color: colors.palette.line),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 8, 6, 0),
                    child: Row(
                      children: <Widget>[
                        Expanded(child: Text(title, style: Theme.of(context).textTheme.headlineSmall)),
                        IconButton(
                          tooltip: 'Close',
                          onPressed: () => Navigator.of(context).maybePop(),
                          icon: const Icon(Icons.close, size: 20),
                        ),
                      ],
                    ),
                  ),
                  Flexible(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                      child: child,
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

/// Runs [onDisposed] when the sheet's content leaves the tree, i.e. after its closing
/// animation. Editors dispose their text controllers here: disposing them as soon as the
/// sheet's future completes left the still-animating fields using disposed controllers
/// ("A TextEditingController was used after being disposed").
class _DisposeWith extends StatefulWidget {
  const _DisposeWith({required this.onDisposed, required this.child});

  final VoidCallback? onDisposed;
  final Widget child;

  @override
  State<_DisposeWith> createState() => _DisposeWithState();
}

class _DisposeWithState extends State<_DisposeWith> {
  @override
  void dispose() {
    widget.onDisposed?.call();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Short message. Errors get the red surface and stay a little longer.
void showToast(BuildContext context, String message, {bool error = false}) {
  final StrackerColors colors = context.stracker;
  final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(
          message,
          style: TextStyle(color: error ? colors.palette.red : colors.palette.ink),
        ),
        backgroundColor: error ? colors.palette.redBg : colors.palette.paperMuted,
        duration: Duration(seconds: error ? 5 : 3),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        action: error
            ? SnackBarAction(
                label: 'Dismiss',
                textColor: colors.palette.red,
                onPressed: messenger.hideCurrentSnackBar,
              )
            : null,
      ),
    );
}

/// Dims and blocks its child while a write is in flight.
class BusyOverlay extends StatelessWidget {
  const BusyOverlay({super.key, required this.busy, required this.child});

  final bool busy;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: <Widget>[
        AbsorbPointer(absorbing: busy, child: Opacity(opacity: busy ? 0.55 : 1, child: child)),
        if (busy)
          const Positioned(
            top: 8,
            right: 8,
            child: WanderingEyes(height: 16),
          ),
      ],
    );
  }
}
