import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/palettes.dart';
import '../../core/theme/theme_controller.dart';
import '../../core/validators.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/exam.dart';
import '../../logic/reminders.dart';
import '../auth/auth_screens.dart';
import '../auth/connection_sheet.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// Settings, grouped the way the website groups them. Changes are held in a draft and
/// written with one save, so a half-edited threshold never reaches the account.
class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({super.key});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  AppSettings? _draft;
  bool _saving = false;
  bool _dirty = false;
  String? _error;

  final TextEditingController _goal = TextEditingController();
  final TextEditingController _weak = TextEditingController();
  final TextEditingController _strong = TextEditingController();
  final TextEditingController _dropping = TextEditingController();
  final TextEditingController _high = TextEditingController();
  final TextEditingController _medium = TextEditingController();
  final TextEditingController _low = TextEditingController();
  final TextEditingController _gaps = TextEditingController();
  final TextEditingController _pyqFrom = TextEditingController();
  final TextEditingController _pyqTo = TextEditingController();
  final TextEditingController _target = TextEditingController();
  final TextEditingController _reminder = TextEditingController();

  @override
  void dispose() {
    for (final TextEditingController controller in <TextEditingController>[
      _goal,
      _weak,
      _strong,
      _dropping,
      _high,
      _medium,
      _low,
      _gaps,
      _pyqFrom,
      _pyqTo,
      _target,
      _reminder,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _seed(AppSettings settings) {
    _draft = settings;
    _goal.text = settings.dailyStudyGoalMinutes.toString();
    _weak.text = numberLabel(settings.weakThreshold, digits: 0);
    _strong.text = numberLabel(settings.strongThreshold, digits: 0);
    _dropping.text = numberLabel(settings.droppingThreshold, digits: 0);
    _high.text = numberLabel(settings.weightHigh, digits: 2);
    _medium.text = numberLabel(settings.weightMedium, digits: 2);
    _low.text = numberLabel(settings.weightLow, digits: 2);
    _gaps.text = settings.revisionGaps.join(', ');
    _pyqFrom.text = settings.pyqFromYear.toString();
    _pyqTo.text = settings.pyqToYear.toString();
    _target.text = numberLabel(settings.targetScore, digits: 0);
    _reminder.text = settings.reminderTime;
  }

  void _touch(AppSettings next) => setState(() {
        _draft = next;
        _dirty = true;
        _error = null;
      });

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    if (_draft == null) _seed(data.settings);
    final AppSettings draft = _draft!;
    final StrackerColors colors = context.stracker;
    final ThemeState appearance = ref.watch(themeControllerProvider);

    return SectionPage(
      title: 'Settings',
      subtitle: _dirty ? 'Unsaved changes' : 'Synced with your account',
      actions: <Widget>[
        if (_dirty)
          TextButton(
            onPressed: _saving ? null : () => _save(data),
            child: const Text('Save'),
          ),
      ],
      child: BusyOverlay(
        busy: _saving,
        child: PageBody(
          refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
          children: <Widget>[
            if (_error != null) ...<Widget>[ErrorNotice(_error!), const SizedBox(height: 10)],
            NotebookCard(
              title: 'Appearance',
              subtitle: 'Shared with Settings → Appearance on the website.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  ChoiceRow<ThemeMode>(
                    label: 'Theme',
                    value: appearance.mode,
                    options: const <ThemeMode>[ThemeMode.light, ThemeMode.dark, ThemeMode.system],
                    labelFor: (ThemeMode mode) => switch (mode) {
                      ThemeMode.light => 'Light',
                      ThemeMode.dark => 'Night',
                      ThemeMode.system => 'Auto',
                    },
                    onChanged: (ThemeMode mode) async {
                      await ref.read(themeControllerProvider.notifier).setMode(mode);
                      _touch(_draft!.copyWith(theme: ref.read(themeControllerProvider).modeValue));
                    },
                  ),
                  const SizedBox(height: 4),
                  Text('Palette', style: Theme.of(context).textTheme.labelMedium),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: <Widget>[
                      for (final ({String id, String label, String description}) option
                          in strackerPaletteOptions)
                        Tooltip(
                          message: option.description,
                          child: ChoiceChip(
                            label: Text(option.label),
                            selected: draft.colorTheme == option.id,
                            showCheckmark: false,
                            onSelected: (_) async {
                              await ref.read(themeControllerProvider.notifier).setPalette(option.id);
                              _touch(_draft!.copyWith(colorTheme: option.id));
                            },
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  AppSelect<String>(
                    label: 'Reading font',
                    value: draft.interfaceFont,
                    items: const <String>['lexend', 'poppins', 'sora', 'open-sans'],
                    labelFor: (String value) => switch (value) {
                      'poppins' => 'Poppins',
                      'sora' => 'Sora',
                      'open-sans' => 'Open Sans',
                      _ => 'Lexend',
                    },
                    helper: 'Patrick Hand stays for headings — it is the Stracker identity.',
                    onChanged: (String? value) async {
                      if (value == null) return;
                      await ref.read(themeControllerProvider.notifier).setReadingFont(value);
                      _touch(_draft!.copyWith(interfaceFont: value));
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            NotebookCard(
              title: 'Study rhythm',
              subtitle: 'Goals and thresholds decide what counts as weak, strong or due.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  AppField(
                    label: 'Daily study goal (minutes)',
                    controller: _goal,
                    keyboardType: TextInputType.number,
                    inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                    error: Validators.dailyGoal(_goal.text),
                    onChanged: (String value) =>
                        _touch(_draft!.copyWith(dailyStudyGoalMinutes: int.tryParse(value) ?? 0)),
                  ),
                  AppField(
                    label: 'Revision gaps (days, comma separated)',
                    controller: _gaps,
                    keyboardType: TextInputType.number,
                    error: Validators.revisionGaps(_gaps.text),
                    helper: 'Default 1, 7, 30. Each completed revision schedules the next gap.',
                    onChanged: (String value) {
                      final List<int> parsed = <int>[
                        for (final String part in value.split(','))
                          if (int.tryParse(part.trim()) != null) int.parse(part.trim()),
                      ];
                      if (Validators.revisionGaps(value) == null && parsed.isNotEmpty) {
                        _touch(_draft!.copyWith(revisionGaps: parsed));
                      }
                    },
                  ),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: AppField(
                          label: 'Weak below %',
                          controller: _weak,
                          keyboardType: TextInputType.number,
                          error: Validators.thresholds(
                            double.tryParse(_weak.text) ?? -1,
                            double.tryParse(_strong.text) ?? -1,
                            double.tryParse(_dropping.text) ?? -1,
                          ),
                          onChanged: (String value) =>
                              _touch(_draft!.copyWith(weakThreshold: double.tryParse(value) ?? 0)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: AppField(
                          label: 'Strong at %',
                          controller: _strong,
                          keyboardType: TextInputType.number,
                          onChanged: (String value) =>
                              _touch(_draft!.copyWith(strongThreshold: double.tryParse(value) ?? 0)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: AppField(
                          label: 'Dropping by',
                          controller: _dropping,
                          keyboardType: TextInputType.number,
                          helper: 'percentage points',
                          onChanged: (String value) => _touch(
                            _draft!.copyWith(droppingThreshold: double.tryParse(value) ?? 0),
                          ),
                        ),
                      ),
                    ],
                  ),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: AppField(
                          label: 'High weight',
                          controller: _high,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          onChanged: (String value) =>
                              _touch(_draft!.copyWith(weightHigh: double.tryParse(value) ?? 1)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: AppField(
                          label: 'Medium weight',
                          controller: _medium,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          onChanged: (String value) =>
                              _touch(_draft!.copyWith(weightMedium: double.tryParse(value) ?? 1)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: AppField(
                          label: 'Low weight',
                          controller: _low,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          onChanged: (String value) =>
                              _touch(_draft!.copyWith(weightLow: double.tryParse(value) ?? 1)),
                        ),
                      ),
                    ],
                  ),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: AppField(
                          label: 'PYQ years from',
                          controller: _pyqFrom,
                          keyboardType: TextInputType.number,
                          onChanged: (String value) =>
                              _touch(_draft!.copyWith(pyqFromYear: int.tryParse(value) ?? 2019)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: AppField(
                          label: 'to',
                          controller: _pyqTo,
                          keyboardType: TextInputType.number,
                          error: Validators.years(
                            int.tryParse(_pyqFrom.text) ?? 0,
                            int.tryParse(_pyqTo.text) ?? 0,
                          ),
                          onChanged: (String value) =>
                              _touch(_draft!.copyWith(pyqToYear: int.tryParse(value) ?? 2026)),
                        ),
                      ),
                    ],
                  ),
                  SwitchRow(
                    title: 'Sound',
                    subtitle: 'Short confirmation sounds in focus mode.',
                    value: draft.soundEnabled,
                    onChanged: (bool value) => _touch(_draft!.copyWith(soundEnabled: value)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            NotebookCard(
              title: 'Exam',
              subtitle: chosenExamTitle(data),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  AppSelect<String?>(
                    label: 'Exam',
                    value: draft.examId,
                    items: <String?>[
                      null,
                      for (final ExamCatalogEntry entry in data.examCatalog)
                        if (!entry.id.startsWith('hidden')) entry.id,
                    ],
                    labelFor: (String? value) =>
                        value == null ? 'JEE (default)' : examNameFor(data, value),
                    helper: data.examCatalog.isEmpty
                        ? 'The published exam catalog could not be loaded; JEE is used.'
                        : '${data.examCatalog.length} exams available.',
                    onChanged: (String? value) => _touch(_draft!.copyWith(examId: value)),
                  ),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: AppField(
                          label: 'Exam year',
                          controller: _pyqTo,
                          enabled: false,
                          helper: 'Set from the exam catalog next release',
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: AppField(
                          label: 'Target score',
                          controller: _target,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          onChanged: (String value) =>
                              _touch(_draft!.copyWith(targetScore: double.tryParse(value) ?? 0)),
                        ),
                      ),
                    ],
                  ),
                  AppDateField(
                    label: 'JEE Main date',
                    value: draft.mainExamDate,
                    allowClear: true,
                    onChanged: (String? value) => _touch(_draft!.copyWith(mainExamDate: value)),
                  ),
                  AppDateField(
                    label: 'JEE Advanced date',
                    value: draft.advancedExamDate,
                    allowClear: true,
                    onChanged: (String? value) => _touch(_draft!.copyWith(advancedExamDate: value)),
                  ),
                  ChoiceRow<String>(
                    label: 'Exam mode',
                    value: draft.examMode,
                    options: const <String>['auto', 'on', 'off'],
                    labelFor: (String value) => switch (value) {
                      'on' => 'Always on',
                      'off' => 'Off',
                      _ => 'Auto (30 days before)',
                    },
                    onChanged: (String value) => _touch(_draft!.copyWith(examMode: value)),
                  ),
                  SwitchRow(
                    title: 'Class 12 boards add-on',
                    subtitle: 'Adds a Boards track next to the entrance exam tracks.',
                    value: draft.boardsAddon,
                    onChanged: (bool value) => _touch(_draft!.copyWith(boardsAddon: value)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            NotebookCard(
              title: 'Reminders',
              subtitle: reminderSummary(draft),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  SwitchRow(
                    title: 'Remind me',
                    subtitle: 'Shown inside the app after the reminder time. The website also sends '
                        'browser notifications; Android system notifications are not wired in this build.',
                    value: draft.remindersEnabled,
                    onChanged: (bool value) => _touch(_draft!.copyWith(remindersEnabled: value)),
                  ),
                  AppField(
                    label: 'Reminder time (24h)',
                    controller: _reminder,
                    hint: '08:00',
                    keyboardType: TextInputType.datetime,
                    error: Validators.reminderTime(_reminder.text),
                    onChanged: (String value) {
                      if (Validators.reminderTime(value) == null) {
                        _touch(_draft!.copyWith(reminderTime: value));
                      }
                    },
                  ),
                  Text('What to include', style: Theme.of(context).textTheme.labelMedium),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: <Widget>[
                      for (final String type in const <String>['revision', 'backlog', 'tests', 'goal'])
                        FilterChip(
                          label: Text(type),
                          selected: draft.reminderTypes.contains(type),
                          onSelected: (bool selected) {
                            final List<String> next = <String>[...draft.reminderTypes];
                            if (selected) {
                              next.add(type);
                            } else {
                              next.remove(type);
                            }
                            _touch(_draft!.copyWith(reminderTypes: next));
                          },
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            NotebookCard(
              title: 'Account & data',
              child: Column(
                children: <Widget>[
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: const Icon(Icons.lock_outline, size: 19),
                    title: const Text('Change password'),
                    trailing: const Icon(Icons.chevron_right, size: 18),
                    onTap: () => openChangePasswordSheet(context, ref),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: const Icon(Icons.backup_outlined, size: 19),
                    title: const Text('Backup & export'),
                    subtitle: Text(
                      draft.lastBackupAt == null
                          ? 'No backup recorded'
                          : 'Last ${formatDate(draft.lastBackupAt)}',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                    trailing: const Icon(Icons.chevron_right, size: 18),
                    onTap: () => Routes.open(context, Routes.backup),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: const Icon(Icons.wifi_tethering, size: 19),
                    title: const Text('Connection check'),
                    subtitle: Text(
                      'Test the link between this phone and your account',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                    ),
                    trailing: const Icon(Icons.chevron_right, size: 18),
                    onTap: () => showConnectionSheet(context),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            ElevatedButton(
              onPressed: _saving ? null : () => _save(data),
              child: Text(_dirty ? 'Save settings' : 'Settings saved'),
            ),
            const SizedBox(height: 8),
            Text(
              'These settings belong to your account, so they follow you to any device you sign in on.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save(AppData data) async {
    final AppSettings draft = _draft!;
    final String? thresholdError = Validators.thresholds(
      double.tryParse(_weak.text) ?? -1,
      double.tryParse(_strong.text) ?? -1,
      double.tryParse(_dropping.text) ?? -1,
    );
    final String? weightsError = Validators.weights(
      double.tryParse(_high.text) ?? 0,
      double.tryParse(_medium.text) ?? 0,
      double.tryParse(_low.text) ?? 0,
    );
    final String? gapsError = Validators.revisionGaps(_gaps.text);
    final String? yearsError = Validators.years(
      int.tryParse(_pyqFrom.text) ?? 0,
      int.tryParse(_pyqTo.text) ?? 0,
    );
    final String? firstError = thresholdError ?? weightsError ?? gapsError ?? yearsError;
    if (firstError != null) {
      setState(() => _error = firstError);
      showToast(context, firstError, error: true);
      return;
    }
    final List<int> gaps = <int>[
      for (final String part in _gaps.text.split(','))
        if (int.tryParse(part.trim()) != null) int.parse(part.trim()),
    ];
    final AppSettings next = draft.copyWith(
      weakThreshold: double.parse(_weak.text),
      strongThreshold: double.parse(_strong.text),
      droppingThreshold: double.parse(_dropping.text),
      weightHigh: double.parse(_high.text),
      weightMedium: double.parse(_medium.text),
      weightLow: double.parse(_low.text),
      revisionGaps: gaps,
      dailyStudyGoalMinutes: int.parse(_goal.text),
      pyqFromYear: int.parse(_pyqFrom.text),
      pyqToYear: int.parse(_pyqTo.text),
      reminderTime: _reminder.text.trim(),
    );
    setState(() => _saving = true);
    try {
      await ref.read(dataControllerProvider.notifier).saveSettings(next);
      if (!mounted) return;
      setState(() {
        _draft = next;
        _dirty = false;
      });
      showToast(context, 'Settings saved.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
      showToast(context, error.toString(), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}
