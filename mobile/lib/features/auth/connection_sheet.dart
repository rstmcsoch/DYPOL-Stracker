import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/config.dart';
import '../../core/theme/app_theme.dart';
import '../../data/connection_check.dart';

/// Shows which project this build talks to and whether that project accepts its key.
///
/// Reached from a failed sign-in ("Check connection") and from Settings → About the
/// connection. It exists because "wrong password" and "wrong project" look identical from
/// the outside, and only the project ref tells them apart.
Future<void> showConnectionSheet(BuildContext context) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: context.stracker.palette.paper,
      builder: (_) => const _ConnectionSheet(),
    );

class _ConnectionSheet extends StatefulWidget {
  const _ConnectionSheet();

  @override
  State<_ConnectionSheet> createState() => _ConnectionSheetState();
}

class _ConnectionSheetState extends State<_ConnectionSheet> {
  ConnectionReport? _report;
  bool _running = true;

  @override
  void initState() {
    super.initState();
    _run();
  }

  Future<void> _run() async {
    setState(() => _running = true);
    final ConnectionReport report = await checkConnection();
    if (!mounted) return;
    setState(() {
      _report = report;
      _running = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final ConnectionReport? report = _report;
    final String ref = projectRefFrom(AppConfig.supabaseUrl);

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 18,
          right: 18,
          top: 4,
          bottom: 18 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('Connection', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 10),
              if (_running)
                Row(
                  children: <Widget>[
                    const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      ref.isEmpty ? 'Asking the server…' : 'Asking project $ref…',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                )
              else if (report != null) ...<Widget>[
                _Verdict(report),
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: colors.palette.bg,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: colors.palette.line),
                  ),
                  child: Text(
                    report.report,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      height: 1.5,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  report.advice,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.inkSoft),
                ),
                const SizedBox(height: 14),
                Row(
                  children: <Widget>[
                    OutlinedButton.icon(
                      onPressed: _run,
                      icon: const Icon(Icons.refresh, size: 16),
                      label: const Text('Run again'),
                    ),
                    const SizedBox(width: 10),
                    TextButton.icon(
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: report.report));
                        if (context.mounted) Navigator.of(context).pop();
                      },
                      icon: const Icon(Icons.copy_rounded, size: 16),
                      label: const Text('Copy'),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _Verdict extends StatelessWidget {
  const _Verdict(this.report);

  final ConnectionReport report;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final bool good = report.keyAccepted;
    final bool warn = !good && report.reachable;
    final Color fg = good
        ? colors.palette.green
        : (warn ? colors.palette.red : colors.palette.inkSoft);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: good
            ? colors.palette.greenBg
            : (warn ? colors.palette.redBg : colors.palette.bg),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: fg.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            good
                ? Icons.check_circle_outline
                : (warn ? Icons.error_outline : Icons.cloud_off_outlined),
            size: 18,
            color: fg,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              report.headline,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: fg),
            ),
          ),
        ],
      ),
    );
  }
}
