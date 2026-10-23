import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/config.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/notebook.dart';
import '../shell/app_shell.dart';

/// The website's owner console (`/control-panel/*`) is not reimplemented here.
///
/// It is a service-role-only admin surface: user administration, role management, audit
/// evidence, security settings, content publishing and media uploads all run through
/// server functions with their own second-factor gate. Those calls cannot be reproduced
/// from an APK without shipping a private key or relaxing RLS — both explicitly out of
/// scope — so this page explains where the console lives and copies its address instead
/// of pretending to be an admin panel.
class OwnerConsolePage extends StatelessWidget {
  const OwnerConsolePage({super.key});

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final String consoleUrl = '${AppConfig.siteUrl}/control-panel';
    return SectionPage(
      title: 'Owner console',
      subtitle: 'DYPOL LABS control centre',
      child: PageBody(
        children: <Widget>[
          const InfoBanner(
            'The owner console stays on the website. It needs a second verification step and '
            'server-side privileges that a phone app must never hold.',
            icon: Icons.admin_panel_settings_outlined,
          ),
          const SizedBox(height: 12),
          NotebookCard(
            title: 'What is on the web console',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                for (final (IconData, String) row in <(IconData, String)>[
                  (Icons.people_outline, 'Accounts, roles and per-user detail'),
                  (Icons.history, 'Audit trail of every administrative change'),
                  (Icons.shield_outlined, 'Security posture and session controls'),
                  (Icons.monitor_heart_outlined, 'Health of the API and database'),
                  (Icons.brush_outlined, 'Appearance, exams and published content'),
                ])
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Row(
                      children: <Widget>[
                        Icon(row.$1, size: 18, color: colors.palette.accent),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(row.$2, style: Theme.of(context).textTheme.bodyMedium),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Open it in a browser',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                SelectableText(
                  consoleUrl,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: colors.palette.textAccent),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: consoleUrl));
                    if (context.mounted) {
                      showToast(context, 'Console address copied. Paste it into your browser.');
                    }
                  },
                  icon: const Icon(Icons.copy_all_outlined, size: 18),
                  label: const Text('Copy console address'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Student data, syllabus and settings stay fully available in this app. Only the '
            'administrative surface is web-only, so the same account keeps working in both places.',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
          ),
        ],
      ),
    );
  }
}
