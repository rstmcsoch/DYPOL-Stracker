import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/app_theme.dart';
import '../../data/connection_check.dart';

/// A plain-language connection check: "can this phone reach my account?".
///
/// Technical values (project id, host, HTTP status) are kept behind a collapsed
/// "Details" row, so a student never sees infrastructure names they cannot act on.
Future<void> showConnectionSheet(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: context.stracker.palette.paper,
      builder: (BuildContext sheetContext) {
        // Sheets should not stretch edge to edge on a tablet.
        return ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: const _ConnectionSheet(),
        );
      },
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
                    Text('Checking…', style: Theme.of(context).textTheme.bodySmall),
                  ],
                )
              else if (report != null) ...<Widget>[
                _Verdict(report),
                const SizedBox(height: 12),
                Row(
                  children: <Widget>[
                    OutlinedButton.icon(
                      onPressed: _run,
                      icon: const Icon(Icons.refresh, size: 16),
                      label: const Text('Check again'),
                    ),
                    const SizedBox(width: 10),
                    TextButton.icon(
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: report.technicalDetails));
                        if (context.mounted) Navigator.of(context).pop();
                      },
                      icon: const Icon(Icons.copy_rounded, size: 16),
                      label: const Text('Copy'),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Theme(
                  // A collapsed row: opened only when someone needs to send details on.
                  data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: const EdgeInsets.only(bottom: 6),
                    title: Text(
                      'Details for support',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(color: colors.muted),
                    ),
                    children: <Widget>[
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: colors.palette.bg,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: colors.palette.line),
                        ),
                        child: Text(
                          report.technicalDetails,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 11.5,
                            height: 1.5,
                          ),
                        ),
                      ),
                    ],
                  ),
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
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
          const SizedBox(height: 8),
          Text(
            report.advice,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.inkSoft),
          ),
        ],
      ),
    );
  }
}
