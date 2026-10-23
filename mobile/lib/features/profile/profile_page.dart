import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/aggregation.dart';
import '../../logic/exam.dart';
import '../../logic/progress.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_screens.dart';
import '../owner/owner_console_page.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// Profile tab: identity, exam tracks, a compact account summary, appearance, password and
/// sign-out. Everything that writes goes to the same Supabase rows the website uses.
class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final DataState state = ref.watch(dataControllerProvider);
    final AppData data = state.data;
    final StrackerColors colors = context.stracker;
    final String today = todayIso();
    final SyllabusProgress progress = syllabusProgress(data);
    final StudyTotals totals = studyTotals(data, today: today);
    final String name = data.profile?.displayName.isNotEmpty == true
        ? data.profile!.displayName
        : (data.settings.ownerName.isEmpty ? 'Stracker student' : data.settings.ownerName);
    final String email = data.profile?.email.isNotEmpty == true
        ? data.profile!.email
        : 'Signed in with Supabase';
    final List<String> tracks = availableTracks(data.settings);
    final String active = effectiveTrack(data.settings);

    return NotebookScaffold(
      title: 'Profile',
      showBrand: true,
      actions: <Widget>[
        IconButton(
          tooltip: 'Settings',
          icon: const Icon(Icons.settings_outlined, size: 20),
          onPressed: () => Routes.open(context, Routes.settings),
        ),
      ],
      body: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          NotebookCard(
            child: Row(
              children: <Widget>[
                Container(
                  width: 58,
                  height: 58,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: colors.palette.accentLight,
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    _initials(name),
                    style: TextStyle(
                      fontFamily: 'PatrickHand',
                      fontSize: 24,
                      color: colors.palette.textAccent,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(name, style: Theme.of(context).textTheme.headlineSmall),
                      Text(email, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted)),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 5,
                        runSpacing: 4,
                        children: <Widget>[
                          Pill(
                            trackLabels(data)[active] ?? chosenExamTitle(data),
                            tone: PillTone.accent,
                            dense: true,
                          ),
                          Pill('${totals.streak} day streak', dense: true),
                        ],
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Edit name',
                  icon: const Icon(Icons.edit_outlined, size: 18),
                  onPressed: () => _editName(context, ref, data, name),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Your notebook',
            subtitle: 'Loaded from your own Supabase account — the same rows the website shows.',
            child: WrapGrid(
              children: <Widget>[
                StatTile(
                  value: percentLabel(progress.raw),
                  label: 'Syllabus',
                  hint: '${progress.completedChapters}/${progress.totalChapters} chapters',
                  onTap: () => Routes.open(context, Routes.syllabus),
                ),
                StatTile(
                  value: '${data.tests.length}',
                  label: 'Tests',
                  hint: '${data.practiceSessions.length} practice blocks',
                  onTap: () => Routes.open(context, Routes.tests),
                ),
                StatTile(
                  value: '${data.mistakes.length}',
                  label: 'Mistakes',
                  hint: '${data.pendingRetries.length} to retry',
                  onTap: () => Routes.open(context, Routes.mistakes),
                ),
                StatTile(
                  value: minutesLabel(totals.totalMinutes),
                  label: 'Study time',
                  hint: 'all recorded time',
                  onTap: () => Routes.open(context, Routes.focus),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Exam tracks',
            subtitle: 'Tracks share one syllabus; only dates, target and labels differ.',
            child: Column(
              children: <Widget>[
                for (final String track in tracks)
                  _TrackRow(
                    data: data,
                    track: track,
                    label: trackLabels(data)[track] ?? track,
                    date: trackDate(data, track),
                    active: track == active,
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Account',
            child: Column(
              children: <Widget>[
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: const Icon(Icons.palette_outlined, size: 19),
                  title: const Text('Appearance'),
                  subtitle: Text(
                    'Theme, palette and reading font',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                  trailing: const Icon(Icons.chevron_right, size: 18),
                  onTap: () => Routes.open(context, Routes.settings),
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: const Icon(Icons.lock_outline, size: 19),
                  title: const Text('Change password'),
                  subtitle: Text(
                    'Uses your Supabase session',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                  trailing: const Icon(Icons.chevron_right, size: 18),
                  onTap: () => openChangePasswordSheet(context, ref),
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: const Icon(Icons.backup_outlined, size: 19),
                  title: const Text('Backup & export'),
                  subtitle: Text(
                    data.settings.lastBackupAt == null
                        ? 'No backup yet'
                        : 'Last backup ${formatDate(data.settings.lastBackupAt)}',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                  trailing: const Icon(Icons.chevron_right, size: 18),
                  onTap: () => Routes.open(context, Routes.backup),
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: const Icon(Icons.admin_panel_settings_outlined, size: 19),
                  title: const Text('Owner console'),
                  subtitle: Text(
                    'Web-only admin surface for DYPOL LABS',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                  trailing: const Icon(Icons.chevron_right, size: 18),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const OwnerConsolePage()),
                  ),
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: const Icon(Icons.logout, size: 19, color: Colors.red),
                  title: Text('Sign out', style: TextStyle(color: colors.palette.red)),
                  subtitle: Text(
                    'Clears the offline copy on this device',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                  onTap: () => _signOut(context, ref),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'About',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Stracker · DYPOL LABS', style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 3),
                Text(
                  'A notebook for JEE preparation.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                ),
                const SizedBox(height: 6),
                Text(
                  'Version 1.0.0 · applicationId come.stracker.dypollabs',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _initials(String name) {
    final List<String> parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return 'S';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1)).toUpperCase();
  }

  Future<void> _editName(BuildContext context, WidgetRef ref, AppData data, String current) async {
    final TextEditingController name = TextEditingController(text: current);
    await showAppSheet<void>(
      context,
      title: 'Your name',
      builder: (BuildContext sheetContext) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppField(
            label: 'Display name',
            controller: name,
            maxLength: 60,
            textCapitalization: TextCapitalization.words,
          ),
          ElevatedButton(
            onPressed: () async {
              if (name.text.trim().isEmpty) {
                showToast(context, 'A name cannot be empty.', error: true);
                return;
              }
              final Profile profile = (data.profile ??
                      Profile(id: data.userId, userId: data.userId, email: ''))
                  .copyWith(displayName: name.text.trim());
              try {
                await ref.read(dataControllerProvider.notifier).saveProfile(profile);
                await ref
                    .read(dataControllerProvider.notifier)
                    .saveSettings(data.settings.copyWith(ownerName: name.text.trim()));
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, 'Name updated.');
              } catch (error) {
                if (context.mounted) showToast(context, error.toString(), error: true);
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    name.dispose();
  }

  Future<void> _signOut(BuildContext context, WidgetRef ref) async {
    final bool confirmed = await confirmAction(
      context,
      title: 'Sign out?',
      message: 'The offline copy on this device is cleared. Your account data stays in Supabase.',
      confirmLabel: 'Sign out',
    );
    if (!confirmed) return;
    try {
      await ref.read(dataControllerProvider.notifier).clearDeviceCache();
      await ref.read(authControllerProvider.notifier).signOut();
    } catch (error) {
      if (context.mounted) showToast(context, error.toString(), error: true);
    }
  }
}

class _TrackRow extends ConsumerWidget {
  const _TrackRow({
    required this.data,
    required this.track,
    required this.label,
    required this.date,
    required this.active,
  });

  final AppData data;
  final String track;
  final String label;
  final String? date;
  final bool active;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final UserExamTrack config = trackConfig(data, track);
    final int? days = date == null ? null : daysUntil(date!);
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: Icon(
        active ? Icons.radio_button_checked : Icons.radio_button_unchecked,
        size: 18,
        color: active ? colors.palette.accent : colors.palette.lineStrong,
      ),
      title: Text(label, style: Theme.of(context).textTheme.titleSmall),
      subtitle: Text(
        <String>[
          date == null ? 'No date set' : formatDate(date),
          if (days != null) countdownLabel(date),
          if (config.targetScore != null) 'target ${numberLabel(config.targetScore)}',
        ].join(' · '),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
      ),
      trailing: TextButton(
        onPressed: () => _editTrack(context, ref, config, label),
        child: Text(active ? 'Edit' : 'Use'),
      ),
      onTap: () => _editTrack(context, ref, config, label),
    );
  }

  Future<void> _editTrack(
    BuildContext context,
    WidgetRef ref,
    UserExamTrack config,
    String label,
  ) async {
    final TextEditingController target = TextEditingController(
      text: config.targetScore == null ? '' : numberLabel(config.targetScore, digits: 0),
    );
    final TextEditingController notes = TextEditingController(text: config.notes);
    String? examDate = config.examDate ?? (track == 'main1'
        ? data.settings.mainExamDate
        : (track == 'advanced' ? data.settings.advancedExamDate : null));
    bool enabled = config.enabled;

    await showAppSheet<void>(
      context,
      title: label,
      builder: (BuildContext sheetContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setSheetState) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            AppDateField(
              label: 'Exam date',
              value: examDate,
              allowClear: true,
              onChanged: (String? value) => setSheetState(() => examDate = value),
            ),
            AppField(
              label: 'Target score',
              controller: target,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            AppField(label: 'Notes', controller: notes, maxLines: 2, maxLength: 500),
            SwitchRow(
              title: 'Track enabled',
              subtitle: 'Disabled tracks stay in the account but are not offered.',
              value: enabled,
              onChanged: (bool value) => setSheetState(() => enabled = value),
            ),
            ElevatedButton(
              onPressed: () async {
                final double? targetValue =
                    target.text.trim().isEmpty ? null : double.tryParse(target.text.trim());
                try {
                  final DataController controller =
                      ref.read(dataControllerProvider.notifier);
                  await controller.saveExamTrack(
                    config.copyWith(
                      label: label,
                      examDate: examDate,
                      targetScore: targetValue,
                      enabled: enabled,
                    ),
                  );
                  AppSettings settings = data.settings.copyWith(
                    activeTrack: track,
                    examMode: data.settings.examMode,
                  );
                  if (track == 'main1') settings = settings.copyWith(mainExamDate: examDate);
                  if (track == 'advanced') settings = settings.copyWith(advancedExamDate: examDate);
                  await controller.saveSettings(settings);
                  if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                  if (context.mounted) showToast(context, '$label saved and set as active.');
                } catch (error) {
                  if (context.mounted) showToast(context, error.toString(), error: true);
                }
              },
              child: const Text('Save and use this track'),
            ),
          ],
        ),
      ),
    );
    target.dispose();
    notes.dispose();
  }
}
