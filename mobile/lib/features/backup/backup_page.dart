import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/date.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/backup.dart';
import '../../logic/report.dart';
import '../shell/app_shell.dart';

/// Backup and restore. Export writes a real JSON file to the app's documents folder and
/// hands it to the Android share sheet; CSV exports do the same per table. Import accepts
/// the JSON text (paste or share into the app) and merges row by row with owner columns
/// rewritten to the signed-in account.
class BackupPage extends ConsumerStatefulWidget {
  const BackupPage({super.key});

  @override
  ConsumerState<BackupPage> createState() => _BackupPageState();
}

class _BackupPageState extends ConsumerState<BackupPage> {
  final TextEditingController _paste = TextEditingController();
  bool _busy = false;
  Map<String, int>? _preview;
  Map<String, dynamic>? _payload;

  @override
  void dispose() {
    _paste.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final DataState state = ref.watch(dataControllerProvider);
    final AppData data = state.data;
    final StrackerColors colors = context.stracker;
    final Map<String, int> counts = backupCounts(buildBackupPayload(data));

    return SectionPage(
      title: 'Backup & export',
      subtitle: data.settings.lastBackupAt == null
          ? 'No backup recorded yet'
          : 'Last backup ${formatDateTime(data.settings.lastBackupAt)}',
      child: BusyOverlay(
        busy: _busy,
        child: PageBody(
          refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
          children: <Widget>[
            NotebookCard(
              title: 'What is in your account',
              subtitle: 'These are the rows a JSON backup will contain.',
              child: Column(
                children: <Widget>[
                  for (final MapEntry<String, int> entry in counts.entries)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 3),
                      child: Row(
                        children: <Widget>[
                          Expanded(
                            child: Text(entry.key, style: Theme.of(context).textTheme.bodySmall),
                          ),
                          Text('${entry.value}', style: Theme.of(context).textTheme.titleSmall),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            NotebookCard(
              title: 'Export',
              subtitle: 'The file is written to this device, then handed to the share sheet. Nothing is '
                  'uploaded anywhere.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  ElevatedButton.icon(
                    onPressed: _busy ? null : _exportJson,
                    icon: const Icon(Icons.file_download_outlined, size: 18),
                    label: const Text('Export JSON backup'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _exportCsvs,
                    icon: const Icon(Icons.table_view_outlined, size: 18),
                    label: const Text('Export CSV tables'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _exportReport,
                    icon: const Icon(Icons.print_outlined, size: 18),
                    label: const Text('Printable report'),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'A clean one-page-per-section summary. Open it and choose Print → Save as '
                    'PDF to keep a copy or share it with a teacher.',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            NotebookCard(
              title: 'Import',
              subtitle: 'Paste a Stracker JSON backup. Rows are merged by id — existing rows are updated, '
                  'new ones are added, nothing is deleted.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  AppField(
                    label: 'Backup JSON',
                    controller: _paste,
                    maxLines: 6,
                    hint: '{ "chapters": [ … ], "tests": [ … ] }',
                    onChanged: (_) => setState(() {
                      _preview = null;
                      _payload = null;
                    }),
                  ),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: OutlinedButton(
                          onPressed: _busy ? null : _previewImport,
                          child: const Text('Preview'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: _busy || _payload == null ? null : _applyImport,
                          child: const Text('Import'),
                        ),
                      ),
                    ],
                  ),
                  if (_preview != null) ...<Widget>[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: colors.palette.paperSoft,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: colors.palette.line),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            '${backupRowTotal(_payload!)} rows in ${_preview!.length} tables',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: 4),
                          for (final MapEntry<String, int> entry in _preview!.entries)
                            Text(
                              '${entry.key}: ${entry.value}',
                              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: colors.muted,
                                  ),
                            ),
                          const SizedBox(height: 6),
                          Text(
                            'Importing rewrites the owner column to your account id and keeps existing ids, '
                            'so it merges rather than duplicates.',
                            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 10),
            InfoBanner(
              'A backup is a copy, not a move: your account stays the source of truth. '
              'Export before big clean-ups, and keep the file off this device too.',
              icon: Icons.verified_user_outlined,
              tone: PillTone.warn,
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _busy ? null : _clearCache,
              icon: const Icon(Icons.cleaning_services_outlined, size: 18),
              label: const Text('Clear cached data on this device'),
            ),
          ],
        ),
      ),
    );
  }

  Future<Directory> _exportDirectory() async {
    final Directory base = await getApplicationDocumentsDirectory();
    final Directory dir = Directory('${base.path}/stracker-exports');
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return dir;
  }

  Future<void> _exportJson() async {
    setState(() => _busy = true);
    try {
      final AppData data = ref.read(dataControllerProvider).data;
      final Directory dir = await _exportDirectory();
      final String stamp = todayIso().replaceAll('-', '');
      final File file = File('${dir.path}/stracker-backup-$stamp.json');
      await file.writeAsString(encodeBackup(data));
      await Share.shareXFiles(
        <XFile>[XFile(file.path, mimeType: 'application/json')],
        subject: 'Stracker backup $stamp',
        text: 'Stracker backup exported from the Android app.',
      );
      await ref.read(dataControllerProvider.notifier).saveSettings(
            data.settings.copyWith(lastBackupAt: isoNow()),
          );
      if (mounted) showToast(context, 'Backup written to ${file.path}');
    } catch (error) {
      if (mounted) showToast(context, error.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The website's report builder produces a PDF; the app produces the same document as a
  /// printable page, so it needs no PDF engine and the phone's own print dialog turns it
  /// into a PDF when the student wants one.
  Future<void> _exportReport() async {
    setState(() => _busy = true);
    try {
      final AppData data = ref.read(dataControllerProvider).data;
      final Directory dir = await _exportDirectory();
      final String stamp = todayIso().replaceAll('-', '');
      final File file = File('${dir.path}/stracker-report-$stamp.html');
      final String owner = data.profile?.displayName.isNotEmpty == true
          ? data.profile!.displayName
          : (data.settings.ownerName.isEmpty ? 'Study notebook' : data.settings.ownerName);
      await file.writeAsBytes(
        printableReportBytes(data, owner: owner, generatedOn: todayIso()),
      );
      await Share.shareXFiles(
        <XFile>[XFile(file.path, mimeType: 'text/html')],
        subject: 'Stracker study report $stamp',
        text: 'Open the report, then use Print to save it as a PDF.',
      );
      if (mounted) showToast(context, 'Report written to ${file.path}');
    } catch (error) {
      if (mounted) showToast(context, error.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _exportCsvs() async {
    setState(() => _busy = true);
    try {
      final AppData data = ref.read(dataControllerProvider).data;
      final Directory dir = await _exportDirectory();
      final String stamp = todayIso().replaceAll('-', '');
      final List<XFile> files = <XFile>[];
      for (final MapEntry<String, String> entry in backupCsvs(data).entries) {
        final File file = File('${dir.path}/stracker-$stamp-${entry.key}.csv');
        await file.writeAsString(entry.value);
        files.add(XFile(file.path, mimeType: 'text/csv'));
      }
      await Share.shareXFiles(
        files,
        subject: 'Stracker CSV export $stamp',
        text: 'Per-table CSV exports from the Stracker Android app.',
      );
      if (mounted) showToast(context, '${files.length} CSV files written to ${dir.path}');
    } catch (error) {
      if (mounted) showToast(context, error.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _previewImport() {
    try {
      final Map<String, dynamic> payload = parseBackupText(_paste.text);
      setState(() {
        _payload = payload;
        _preview = backupCounts(payload);
      });
      showToast(context, '${backupRowTotal(payload)} rows ready to import.');
    } catch (error) {
      setState(() {
        _payload = null;
        _preview = null;
      });
      showToast(context, error.toString(), error: true);
    }
  }

  Future<void> _applyImport() async {
    final Map<String, dynamic>? payload = _payload;
    if (payload == null) return;
    final bool confirmed = await confirmAction(
      context,
      title: 'Import ${backupRowTotal(payload)} rows?',
      message: 'Existing rows with the same id are overwritten with the file’s values. Nothing is '
          'deleted. This writes to your account, so the website will see the imported rows too.',
      confirmLabel: 'Import',
    );
    if (!confirmed) return;
    setState(() => _busy = true);
    try {
      final int written = await ref.read(dataControllerProvider.notifier).importBackup(payload);
      if (mounted) {
        setState(() {
          _paste.clear();
          _payload = null;
          _preview = null;
        });
        showToast(context, '$written rows imported.');
      }
    } catch (error) {
      if (mounted) showToast(context, error.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _clearCache() async {
    final bool confirmed = await confirmAction(
      context,
      title: 'Clear the local cache?',
      message: 'The app forgets the offline copy on this device. Your account data is untouched — it '
          'loads again from your account on the next refresh.',
      confirmLabel: 'Clear cache',
    );
    if (!confirmed) return;
    try {
      await ref.read(dataControllerProvider.notifier).clearDeviceCache();
      if (mounted) showToast(context, 'Cache cleared.');
    } catch (error) {
      if (mounted) showToast(context, error.toString(), error: true);
    }
  }
}
