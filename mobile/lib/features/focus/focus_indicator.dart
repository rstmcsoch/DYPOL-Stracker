import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../logic/focus.dart';
import '../shell/routes.dart';
import 'focus_controller.dart';

/// "Focus in progress · 18 min · Resume" on Home while a block is running or paused
/// with unsaved time, so leaving the Focus screen never hides or loses a block.
class FocusIndicator extends ConsumerWidget {
  const FocusIndicator({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final FocusTimerState timer = ref.watch(focusControllerProvider);
    final DateTime now = DateTime.now();
    if (!timer.running && !timer.hasUnsavedAt(now)) return const SizedBox.shrink();
    final StrackerColors colors = context.stracker;
    final int minutes = timer.elapsedAt(now) ~/ 60;
    final String label = '${timer.running ? 'Focus in progress' : 'Focus paused'} · $minutes min';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Semantics(
        liveRegion: true,
        label: label,
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
          decoration: BoxDecoration(
            color: colors.palette.paper,
            border: Border.all(color: colors.palette.accent),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: <Widget>[
              Icon(timer.running ? Icons.timer_outlined : Icons.pause_circle_outline,
                  size: 18, color: colors.palette.accent),
              const SizedBox(width: 8),
              Expanded(
                child: Text(label, style: Theme.of(context).textTheme.bodyMedium),
              ),
              TextButton(
                onPressed: () => Routes.open(context, Routes.focus),
                child: Text(timer.running ? 'Return to focus' : 'Resume'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
