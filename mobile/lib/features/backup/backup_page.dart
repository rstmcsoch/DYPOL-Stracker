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
import '../../logic/analytics.dart';
import '../../logic/backup.dart';
import '../../logic/home_summary.dart';
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
  bool _confirmMerge = false;
  String _reportFrom = '';
  String _reportTo = todayIso();
  final Set<String> _sections = <String>{for (final section in reportSections) section.key};

  @override
  void dispose() {
    _paste.dispose();
    super.dispose();
  }

  /// Website `reportSchema`: an optional range whose start is not after its end.
  bool _rangeOk() {
    if (_reportFrom.isNotEmpty && _reportTo.isNotEmpty && _reportFrom.compareTo(_reportTo) > 0) {
      showToast(context, 'Start date must be before end date.', error: true);
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final DataState state = ref.watch(dataControllerProvider);
    final AppData data = state.data;
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final int records = backupRowTotal(buildBackupPayload(data));
    final String? lastBackup = data.settings.lastBackupAt;
    final int? backupAge = lastBackup == null ? null : daysBetween(indiaDate(lastBackup), todayIso());
    final bool reminderDue = backupAge == null || backupAge >= 7;

    return SectionPage(
      title: 'Export & backup',
      subtitle: 'Download, import or report your data.',
      child: BusyOverlay(
        busy: _busy,
        child: PageBody(
          refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
          children: <Widget>[
            if (reminderDue) ...<Widget>[
              NotebookCard(
                accent: colors.palette.orange,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Icon(Icons.verified_user_outlined, size: 18, color: colors.palette.orange),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                backupAge == null
                                    ? 'You haven’t made a backup yet.'
                                    : 'Your last backup was $backupAge days ago.',
                                style: text.titleSmall,
                              ),
                              Text(
                                'Export a private JSON backup to keep your study history safe.',
                                style: text.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerRight,
                      child: ElevatedButton.icon(
                        onPressed: _busy ? null : _exportJson,
                        icon: const Icon(Icons.download_outlined, size: 16),
                        label: const Text('Backup now'),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
            ],
            WrapGrid(
              minItemWidth: 280,
              spacing: 10,
              runSpacing: 10,
              children: <Widget>[
                _ExportCard(
                  icon: Icons.folder_zip_outlined,
                  badge: 'FULL BACKUP',
                  badgeTone: PillTone.good,
                  title: 'JSON notebook backup',
                  body: 'Settings, syllabus, notes, tests, mistakes, revisions, tasks, goals, sessions and '
                      'compressed images.',
                  points: const <(IconData, String)>[
                    (Icons.check_circle_outline, 'All owner data in one file'),
                    (Icons.check_circle_outline, 'Re-importable and relationship-aware'),
                    (Icons.lock_outline, 'Owner-scoped; no server secret included'),
                  ],
                  action: ElevatedButton.icon(
                    onPressed: _busy ? null : _exportJson,
                    icon: const Icon(Icons.cloud_download_outlined, size: 17),
                    label: const Text('Download JSON backup'),
                  ),
                  footer: lastBackup == null
                      ? 'No JSON backup recorded yet'
                      : 'Last JSON backup: ${prettyDate(indiaDate(lastBackup))}',
                ),
                _ExportCard(
                  icon: Icons.table_view_outlined,
                  badge: 'SPREADSHEET READY',
                  badgeTone: PillTone.warn,
                  title: 'Test history CSV',
                  body: 'A clean, UTF-8 CSV for Excel or Google Sheets, including score, accuracy fields, notes '
                      'and mock subject marks.',
                  points: const <(IconData, String)>[
                    (Icons.check_circle_outline, 'Excel-friendly UTF-8 BOM'),
                    (Icons.check_circle_outline, 'Optional date range'),
                    (Icons.check_circle_outline, 'No invented percentages'),
                  ],
                  action: Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: <Widget>[
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _exportTestCsv,
                        icon: const Icon(Icons.download_outlined, size: 17),
                        label: const Text('Export test CSV'),
                      ),
                      TextButton(
                        onPressed: _busy ? null : _exportCsvs,
                        child: const Text('Every table as CSV'),
                      ),
                    ],
                  ),
                  footer: '${data.tests.length} test record${data.tests.length == 1 ? '' : 's'} in this notebook',
                ),
              ],
            ),
            const SizedBox(height: 10),
            NotebookCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Icon(Icons.print_outlined, size: 20, color: colors.palette.textAccent),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              'A POLISHED REVIEW, ON PAPER',
                              style: text.labelSmall?.copyWith(letterSpacing: 1.2, color: colors.muted),
                            ),
                            Text('Build a study report', style: text.titleMedium),
                            Text(
                              'Choose the time window and sections. Everything comes from saved data.',
                              style: text.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  AppDateField(
                    label: 'From date',
                    value: _reportFrom.isEmpty ? null : _reportFrom,
                    allowClear: true,
                    onChanged: (String? value) => setState(() => _reportFrom = value ?? ''),
                  ),
                  AppDateField(
                    label: 'To date',
                    value: _reportTo.isEmpty ? null : _reportTo,
                    allowClear: true,
                    onChanged: (String? value) => setState(() => _reportTo = value ?? ''),
                  ),
                  Text(
                    'Leave “From” blank to include all recorded history. Reports are generated on this device.',
                    style: text.labelSmall?.copyWith(color: colors.muted),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: <Widget>[
                      Expanded(child: Text('Include in the report', style: text.titleSmall)),
                      TextButton(
                        onPressed: () => setState(() {
                          _sections.addAll(<String>[for (final section in reportSections) section.key]);
                        }),
                        child: const Text('Select all'),
                      ),
                    ],
                  ),
                  for (final section in reportSections)
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: _sections.contains(section.key),
                      title: Text(section.label),
                      subtitle: Text(section.note),
                      onChanged: (bool? value) => setState(() {
                        if (value ?? false) {
                          _sections.add(section.key);
                        } else {
                          _sections.remove(section.key);
                        }
                      }),
                    ),
                  const SizedBox(height: 6),
                  Text(
                    'Output: a printable page — open it and choose Print → Save as PDF.',
                    style: text.labelSmall?.copyWith(color: colors.muted),
                  ),
                  const SizedBox(height: 6),
                  ElevatedButton.icon(
                    onPressed: _busy ? null : _exportReport,
                    icon: const Icon(Icons.description_outlined, size: 17),
                    label: const Text('Generate report'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            NotebookCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(
                    'MOVE YOUR DATA SAFELY',
                    style: text.labelSmall?.copyWith(letterSpacing: 1.2, color: colors.muted),
                  ),
                  Text('Restore from JSON', style: text.titleMedium),
                  Text(
                    'Import merges matching IDs and preserves links. Nothing is changed until you review the '
                    'preview and confirm.',
                    style: text.bodySmall,
                  ),
                  const SizedBox(height: 10),
                  if (_preview == null) ...<Widget>[
                    AppField(
                      label: 'Paste a Stracker JSON backup',
                      controller: _paste,
                      maxLines: 6,
                      hint: '{ "chapters": [ … ], "tests": [ … ] }',
                      onChanged: (_) {},
                    ),
                    Text(
                      'Your existing notebook is left as-is until you confirm the merge. '
                      '$records records in current cache.',
                      style: text.labelSmall?.copyWith(color: colors.muted),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _previewImport,
                      icon: const Icon(Icons.upload_outlined, size: 17),
                      label: const Text('Preview backup'),
                    ),
                  ] else ...<Widget>[
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            'IMPORT PREVIEW',
                            style: text.labelSmall?.copyWith(letterSpacing: 1.2, color: colors.muted),
                          ),
                        ),
                        const Pill('Structure looks good', tone: PillTone.good, dense: true),
                      ],
                    ),
                    const SizedBox(height: 6),
                    WrapGrid(
                      minItemWidth: 130,
                      spacing: 6,
                      runSpacing: 6,
                      children: <Widget>[
                        for (final MapEntry<String, int> entry in _preview!.entries)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: colors.palette.paperSoft,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: colors.palette.line),
                            ),
                            child: Row(
                              children: <Widget>[
                                Expanded(
                                  child: Text(
                                    entry.key.replaceAll('_', ' '),
                                    overflow: TextOverflow.ellipsis,
                                    style: text.labelSmall,
                                  ),
                                ),
                                Text('${entry.value}', style: text.titleSmall),
                              ],
                            ),
                          ),
                      ],
                    ),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: _confirmMerge,
                      title: const Text('I understand that records with matching IDs will be updated by this merge.'),
                      onChanged: (bool? value) => setState(() => _confirmMerge = value ?? false),
                    ),
                    Wrap(
                      alignment: WrapAlignment.end,
                      spacing: 8,
                      runSpacing: 6,
                      children: <Widget>[
                        OutlinedButton(
                          onPressed: _busy
                              ? null
                              : () => setState(() {
                                    _preview = null;
                                    _payload = null;
                                    _confirmMerge = false;
                                  }),
                          child: const Text('Cancel import'),
                        ),
                        ElevatedButton.icon(
                          onPressed: _busy || !_confirmMerge ? null : _applyImport,
                          icon: const Icon(Icons.move_to_inbox_outlined, size: 16),
                          label: const Text('Confirm merge'),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(Icons.lock_outline, size: 15, color: colors.muted),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Exports are generated on this device and saved to it. Stracker does not send reports to a '
                    'third-party service.',
                    style: text.labelSmall?.copyWith(color: colors.muted),
                  ),
                ),
              ],
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
    if (!_rangeOk()) return;
    if (_sections.isEmpty) {
      showToast(context, 'Choose at least one report section.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final AppData data = ref.read(dataControllerProvider).data;
      final Directory dir = await _exportDirectory();
      final String stamp = todayIso().replaceAll('-', '');
      final File file = File('${dir.path}/stracker-report-$stamp.html');
      final String owner = data.settings.ownerName.isNotEmpty
          ? data.settings.ownerName
          : (data.profile?.displayName.isNotEmpty == true ? data.profile!.displayName : 'Study notebook');
      await file.writeAsBytes(
        printableReportBytes(
          data,
          owner: owner,
          generatedOn: todayIso(),
          from: _reportFrom,
          to: _reportTo,
          sections: _sections,
        ),
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

  Future<void> _exportTestCsv() async {
    if (!_rangeOk()) return;
    setState(() => _busy = true);
    try {
      final AppData data = ref.read(dataControllerProvider).data;
      final Directory dir = await _exportDirectory();
      final File file = File('${dir.path}/stracker-test-history-${todayIso()}.csv');
      await file.writeAsString(testsToCsv(data, from: _reportFrom, to: _reportTo));
      await Share.shareXFiles(
        <XFile>[XFile(file.path, mimeType: 'text/csv')],
        subject: 'Stracker test history ${todayIso()}',
      );
      if (mounted) showToast(context, 'Test history exported as an Excel-ready CSV.');
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
        _confirmMerge = false;
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
    if (payload == null || !_confirmMerge) return;
    setState(() => _busy = true);
    try {
      final int written = await ref.read(dataControllerProvider.notifier).importBackup(payload);
      if (mounted) {
        setState(() {
          _paste.clear();
          _payload = null;
          _preview = null;
          _confirmMerge = false;
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

class _ExportCard extends StatelessWidget {
  const _ExportCard({
    required this.icon,
    required this.badge,
    required this.badgeTone,
    required this.title,
    required this.body,
    required this.points,
    required this.action,
    required this.footer,
  });

  final IconData icon;
  final String badge;
  final PillTone badgeTone;
  final String title;
  final String body;
  final List<(IconData, String)> points;
  final Widget action;
  final String footer;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    return NotebookCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(icon, size: 20, color: colors.palette.textAccent),
              const Spacer(),
              Pill(badge, tone: badgeTone, dense: true),
            ],
          ),
          const SizedBox(height: 6),
          Text(title, style: text.titleMedium),
          const SizedBox(height: 2),
          Text(body, style: text.bodySmall),
          const SizedBox(height: 6),
          for (final (IconData glyph, String point) in points)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                children: <Widget>[
                  Icon(glyph, size: 14, color: colors.palette.green),
                  const SizedBox(width: 6),
                  Expanded(child: Text(point, style: text.labelSmall)),
                ],
              ),
            ),
          const SizedBox(height: 8),
          action,
          const SizedBox(height: 4),
          Text(footer, style: text.labelSmall?.copyWith(color: colors.muted)),
        ],
      ),
    );
  }
}
