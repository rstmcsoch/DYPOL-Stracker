import 'package:flutter/material.dart';

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
}) {
  final StrackerColors colors = context.stracker;
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: colors.palette.paper,
    builder: (BuildContext sheetContext) {
      final double viewport = MediaQuery.sizeOf(sheetContext).height;
      return Padding(
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
      );
    },
  );
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
