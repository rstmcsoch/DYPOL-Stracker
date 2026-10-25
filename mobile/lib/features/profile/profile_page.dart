import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/buttons.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../core/widgets/wandering_eyes.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/aggregation.dart';
import '../../logic/exam.dart';
import '../../logic/home_summary.dart';
import '../../logic/onboarding.dart';
import '../../logic/progress.dart';
import '../auth/auth_screens.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';
import 'about_page.dart';
import 'appearance_card.dart';

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
    // Same order as the website: the name chosen in setup, then the account profile.
    final String name = data.settings.ownerName.trim().isNotEmpty
        ? data.settings.ownerName.trim()
        : (data.profile?.displayName.isNotEmpty == true ? data.profile!.displayName : 'Your notebook');
    final StreakSummary streak = computeStreaks(data, today);
    final String email = data.profile?.email.isNotEmpty == true ? data.profile!.email : 'Signed in';
    final List<String> tracks = availableTracks(data.settings);
    final String active = effectiveTrack(data.settings);

    return NotebookScaffold(
      title: 'Profile',
      showBrand: true,
      // As on the website, Profile is a destination of its own with no menu button.
      showMenu: false,
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
                    name.trim().isEmpty ? 'S' : name.trim()[0].toUpperCase(),
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
          const SizedBox(height: 8),
          // The website's study-rhythm row under the identity card.
          WrapGrid(
            minItemWidth: 96,
            children: <Widget>[
              StatTile(
                value: '${streak.current} day${streak.current == 1 ? '' : 's'}',
                label: 'current streak',
                tone: streak.current > 0 ? colors.palette.orange : null,
              ),
              StatTile(value: '${streak.longest} day${streak.longest == 1 ? '' : 's'}', label: 'longest streak'),
              StatTile(value: '${streak.weeklyConsistency}/7', label: 'active this week'),
            ],
          ),
          const SizedBox(height: 10),
          const ExamSelectionCard(),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'Theme, palette and reading font are in Appearance below. AI and account settings: the gear at the top.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
            ),
          ),
          NotebookCard(
            title: 'Your notebook',
            subtitle: 'Everything you have logged, in one place.',
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
          // Theme, palette and reading font: chosen only here (no toggle elsewhere).
          const AppearanceCard(),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Account',
            child: Column(
              children: <Widget>[
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: const Icon(Icons.lock_outline, size: 19),
                  title: const Text('Change password'),
                  subtitle: Text(
                    'Set a new password for your account',
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
                const SizedBox(height: 4),
                Text(
                  'A focused digital study notebook for exam preparation.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                ),
                const SizedBox(height: 10),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: const Icon(Icons.auto_stories_outlined, size: 19),
                  title: const Text('About Stracker'),
                  subtitle: Text(
                    'What the notebook is for, and how it works',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                  trailing: const Icon(Icons.chevron_right, size: 18),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const AboutPage()),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Version 1.0.0',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _editName(BuildContext context, WidgetRef ref, AppData data, String current) async {
    final TextEditingController name = TextEditingController(text: current);
    // A single field: the compact centred window, not the tall form sheet.
    await showCompactDialog<void>(
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
          SaveButton(
            label: 'Save',
            onPressed: () async {
              if (name.text.trim().isEmpty) {
                showToast(context, 'A name cannot be empty.', error: true);
                return;
              }
              final Profile profile = (data.profile ?? Profile(id: data.userId, userId: data.userId, email: ''))
                  .copyWith(displayName: name.text.trim());
              try {
                await ref.read(dataControllerProvider.notifier).saveProfile(profile);
                await ref
                    .read(dataControllerProvider.notifier)
                    .saveSettings(ref.read(dataControllerProvider).data.settings.copyWith(ownerName: name.text.trim()));
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                if (context.mounted) showToast(context, 'Name updated.');
              } catch (error) {
                if (context.mounted) showToast(context, userMessage(error), error: true);
              }
            },
          ),
        ],
      ),
      onDisposed: () {
        name.dispose();
      },
    );
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
    String? examDate = config.examDate ??
        (track == 'main1' ? data.settings.mainExamDate : (track == 'advanced' ? data.settings.advancedExamDate : null));
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
            SaveButton(
              label: 'Save and use this track',
              onPressed: () async {
                final double? targetValue = target.text.trim().isEmpty ? null : double.tryParse(target.text.trim());
                if (target.text.trim().isNotEmpty && (targetValue == null || targetValue < 0)) {
                  showToast(context, 'Enter the target score as a number, like 250.', error: true);
                  return;
                }
                try {
                  final DataController controller = ref.read(dataControllerProvider.notifier);
                  await controller.saveExamTrack(
                    config.copyWith(
                      label: label,
                      examDate: examDate,
                      targetScore: targetValue,
                      enabled: enabled,
                    ),
                  );
                  AppSettings settings = ref.read(dataControllerProvider).data.settings.copyWith(
                    activeTrack: track,
                    examMode: data.settings.examMode,
                  );
                  if (track == 'main1') settings = settings.copyWith(mainExamDate: examDate);
                  if (track == 'advanced') settings = settings.copyWith(advancedExamDate: examDate);
                  await controller.saveSettings(settings);
                  if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                  if (context.mounted) showToast(context, '$label saved and set as active.');
                } catch (error) {
                  if (context.mounted) showToast(context, userMessage(error), error: true);
                }
              },
            ),
          ],
        ),
      ),
      onDisposed: () {
        target.dispose();
        notes.dispose();
      },
    );
  }
}

/// The website's "Your exam" section (ExamSelectionSection): exam, target year, attempt /
/// session, the Class 12 boards add-on and board, saved to the same app_settings columns.
class ExamSelectionCard extends ConsumerStatefulWidget {
  const ExamSelectionCard({super.key});

  @override
  ConsumerState<ExamSelectionCard> createState() => _ExamSelectionCardState();
}

class _ExamSelectionCardState extends ConsumerState<ExamSelectionCard> {
  String? _examId;
  int? _year;
  String? _session;
  String? _board;
  bool _addon = false;
  bool _saving = false;
  String? _syncedFrom;

  void _syncFrom(AppSettings settings) {
    final String key = '${settings.examId}|${settings.examYear}|${settings.examSession}|'
        '${settings.examBoard}|${settings.boardsAddon}';
    if (_syncedFrom == key) return;
    _syncedFrom = key;
    _examId = settings.examId ?? 'jee';
    _year = settings.examYear;
    _session = settings.examSession;
    _board = settings.examBoard;
    _addon = settings.boardsAddon;
  }

  @override
  Widget build(BuildContext context) {
    final DataState state = ref.watch(dataControllerProvider);
    final AppData data = state.data;
    final StrackerColors colors = context.stracker;
    _syncFrom(data.settings);
    final List<ExamCatalogEntry> catalog = data.examCatalog;
    // An exam the student is already on stays selectable even if it was hidden later.
    final List<ExamCatalogEntry> options = <ExamCatalogEntry>[
      if (!catalog.any((ExamCatalogEntry e) => e.id == _examId))
        _examId == 'jee'
            ? fallbackJeeExam
            : ExamCatalogEntry(id: _examId!, name: '$_examId (no longer listed)', category: 'Your exam'),
      ...catalog,
    ];
    final ExamCatalogEntry exam =
        options.firstWhere((ExamCatalogEntry e) => e.id == _examId, orElse: () => options.first);
    final List<int> years = examYears(exam);
    final List<int> yearChoices = <int>[if (_year != null && !years.contains(_year)) _year!, ...years];
    final List<String> boardChoices = exam.boards.isNotEmpty ? exam.boards : schoolBoards;
    final bool needsBoard = onboardingNeedsBoard(exam, _addon);
    final TextStyle? small = Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted);

    return NotebookCard(
      title: 'Your exam',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (catalog.isEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: <Widget>[
                  Expanded(child: Text('The exam list could not be loaded.', style: small)),
                  TextButton(
                    onPressed: () => ref.read(dataControllerProvider.notifier).load(silent: true),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          AppSelect<String>(
            label: 'Exam',
            value: exam.id,
            items: <String>[for (final ExamCatalogEntry e in options) e.id],
            labelFor: (String id) {
              final ExamCatalogEntry e = options.firstWhere((ExamCatalogEntry x) => x.id == id);
              return e.category.isEmpty ? e.name : '${e.name} · ${e.category}';
            },
            onChanged: (String? id) {
              if (id == null) return;
              final ExamCatalogEntry next = options.firstWhere((ExamCatalogEntry e) => e.id == id);
              setState(() {
                _examId = id;
                if (!next.sessions.contains(_session)) _session = null;
                if (!next.boardsAddon) _addon = false;
              });
            },
          ),
          AppSelect<int?>(
            label: 'Target year',
            value: _year,
            items: <int?>[null, ...yearChoices],
            labelFor: (int? y) => y == null ? 'Not set' : '$y',
            onChanged: (int? y) => setState(() => _year = y),
          ),
          if (exam.sessions.isNotEmpty)
            AppSelect<String?>(
              label: exam.sessionLabel.isEmpty ? 'Attempt / session' : exam.sessionLabel,
              value: exam.sessions.contains(_session) ? _session : null,
              items: <String?>[null, ...exam.sessions],
              labelFor: (String? v) => v ?? 'Not set',
              onChanged: (String? v) => setState(() => _session = v),
            ),
          if (exam.boardsAddon)
            SwitchRow(
              title: 'Also track my Class 12 boards',
              value: _addon,
              onChanged: (bool v) => setState(() => _addon = v),
            ),
          if (needsBoard)
            AppSelect<String?>(
              label: exam.boards.isNotEmpty ? 'Board' : 'Class 12 board',
              value: boardChoices.contains(_board) ? _board : null,
              items: <String?>[null, ...boardChoices],
              labelFor: (String? v) => v ?? 'Not set',
              onChanged: (String? v) => setState(() => _board = v),
            ),
          Text('Subjects: ${onboardingSubjects(exam, session: _session, addon: _addon).join(', ')}', style: small),
          if (!isJeeExam(exam.id)) ...<Widget>[
            const SizedBox(height: 4),
            Text(
              'Your existing syllabus, tests and notes are kept as they are. A new notebook for this exam starts '
              'with an empty syllabus you can fill in on the Syllabus page.',
              style: small,
            ),
          ],
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton.icon(
              onPressed: _saving ? null : () => _save(data.settings, exam, needsBoard),
              icon: _saving
                  ? const WanderingEyes(height: 12)
                  : const Icon(Icons.check, size: 16),
              label: const Text('Save exam'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _save(AppSettings settings, ExamCatalogEntry exam, bool needsBoard) async {
    setState(() => _saving = true);
    try {
      await ref.read(dataControllerProvider.notifier).saveSettings(
            settings.copyWith(
              examId: exam.id,
              examYear: _year,
              examSession: exam.sessions.isNotEmpty && (_session ?? '').isNotEmpty ? _session : null,
              examBoard: needsBoard && (_board ?? '').isNotEmpty ? _board : null,
              boardsAddon: exam.boardsAddon && _addon,
            ),
          );
      if (mounted) showToast(context, 'Exam saved.');
      await HapticFeedback.lightImpact();
    } catch (error) {
      if (mounted) showToast(context, userMessage(error), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}
