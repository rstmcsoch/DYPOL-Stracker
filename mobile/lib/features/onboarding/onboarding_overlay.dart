import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/fields.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/onboarding.dart';

/// First-run setup, the website's OnboardingDialog: it cannot be dismissed and covers the
/// notebook until name, exam (with the year, session or board it needs) and light/dark are
/// chosen. Shown only after this account's settings have really loaded from the cloud.
class OnboardingOverlay extends ConsumerStatefulWidget {
  const OnboardingOverlay({super.key});

  @override
  ConsumerState<OnboardingOverlay> createState() => _OnboardingOverlayState();
}

class _OnboardingOverlayState extends ConsumerState<OnboardingOverlay> {
  late final TextEditingController _name;
  String? _examId;
  int? _year;
  String? _session;
  String? _board;
  bool _addon = false;
  String? _theme;
  String? _problem;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final AppData data = ref.read(dataControllerProvider).data;
    final String owner = data.settings.ownerName;
    final String display = data.profile?.displayName ?? '';
    _name = TextEditingController(text: owner.isNotEmpty ? owner : display);
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  List<ExamCatalogEntry> _catalog(AppData data) =>
      data.examCatalog.isEmpty ? const <ExamCatalogEntry>[fallbackJeeExam] : data.examCatalog;

  void _chooseExam(List<ExamCatalogEntry> catalog, String id) {
    final ExamCatalogEntry next = catalog.firstWhere((ExamCatalogEntry e) => e.id == id);
    setState(() {
      _examId = id;
      if (!next.sessions.contains(_session)) _session = null;
      if (!next.boardsAddon) _addon = false;
      if (next.boards.isNotEmpty && !next.boards.contains(_board)) _board = null;
      if (_year != null && !examYears(next).contains(_year)) _year = null;
    });
  }

  Future<void> _submit(ExamCatalogEntry? exam) async {
    if (_saving) return;
    FocusScope.of(context).unfocus();
    final String? problem = onboardingProblem(
      name: _name.text,
      exam: exam,
      year: _year,
      session: _session,
      addon: _addon,
      board: _board,
      theme: _theme,
    );
    if (problem != null) {
      await HapticFeedback.mediumImpact();
      setState(() => _problem = problem);
      return;
    }
    setState(() {
      _problem = null;
      _saving = true;
    });
    final DataController controller = ref.read(dataControllerProvider.notifier);
    final AppSettings settings = onboardingSettings(
      ref.read(dataControllerProvider).data.settings,
      name: _name.text,
      exam: exam!,
      year: _year!,
      session: _session,
      addon: _addon,
      board: _board,
      theme: _theme!,
    );
    try {
      await controller.completeOnboarding(settings: settings, displayName: _name.text.trim());
      await HapticFeedback.lightImpact();
    } catch (error) {
      if (!mounted) return;
      setState(() =>
          _problem = error is AppFailure ? error.message : 'Could not save. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _select<T>({
    Key? key,
    required String label,
    required T? value,
    required String hint,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
  }) {
    final StrackerColors colors = context.stracker;
    return Padding(
      key: key,
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('$label *', style: Theme.of(context).textTheme.labelMedium?.copyWith(color: colors.palette.inkSoft)),
          const SizedBox(height: 5),
          DropdownButtonFormField<T>(
            initialValue: value,
            isExpanded: true,
            hint: Text(hint),
            dropdownColor: colors.palette.paper,
            borderRadius: BorderRadius.circular(12),
            menuMaxHeight: 420,
            items: items,
            onChanged: _saving ? null : onChanged,
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final AppData data = ref.watch(dataControllerProvider).data;
    final List<ExamCatalogEntry> catalog = _catalog(data);
    ExamCatalogEntry? exam;
    for (final ExamCatalogEntry entry in catalog) {
      if (entry.id == _examId) exam = entry;
    }
    final List<int> years = exam == null ? const <int>[] : examYears(exam);
    final bool needsBoard = onboardingNeedsBoard(exam, _addon);
    final List<String> boardChoices = exam != null && exam.boards.isNotEmpty ? exam.boards : schoolBoards;
    final List<String> subjects =
        exam == null ? const <String>[] : onboardingSubjects(exam, session: _session, addon: _addon);

    final List<DropdownMenuItem<String>> examItems = <DropdownMenuItem<String>>[
      for (final MapEntry<String, List<ExamCatalogEntry>> group
          in groupByCategory(catalog)) ...<DropdownMenuItem<String>>[
        DropdownMenuItem<String>(
          enabled: false,
          value: '__group_${group.key}',
          child: Text(
            group.key.toUpperCase(),
            style: TextStyle(fontSize: 11, letterSpacing: 1.2, fontWeight: FontWeight.w700, color: colors.muted),
          ),
        ),
        for (final ExamCatalogEntry item in group.value)
          DropdownMenuItem<String>(value: item.id, child: Text(item.name, overflow: TextOverflow.ellipsis)),
      ],
    ];

    Widget themeOption(String value, IconData icon, String label) {
      final bool selected = _theme == value;
      return Expanded(
        child: Semantics(
          inMutuallyExclusiveGroup: true,
          checked: selected,
          child: Material(
            color: selected ? colors.palette.accentLight : colors.palette.paperSoft,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
              side: BorderSide(color: selected ? colors.palette.accent : colors.palette.line),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: _saving
                  ? null
                  : () {
                      HapticFeedback.selectionClick();
                      setState(() => _theme = value);
                    },
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Icon(icon, size: 16, color: selected ? colors.palette.textAccent : colors.inkSoft),
                    const SizedBox(width: 6),
                    Text(label, style: text.bodyMedium?.copyWith(color: selected ? colors.palette.textAccent : null)),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    return PopScope(
      // Like the website, setup cannot be dismissed; back leaves it in place.
      canPop: false,
      child: Material(
        color: Colors.black.withValues(alpha: .45),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(14, 14, 14, 14 + MediaQuery.viewInsetsOf(context).bottom),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 14),
                  decoration: BoxDecoration(
                    color: colors.palette.paper,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: colors.palette.lineStrong),
                  ),
                  child: Semantics(
                    scopesRoute: true,
                    namesRoute: true,
                    explicitChildNodes: true,
                    label: 'Set up your notebook',
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Text('Set up your notebook', style: text.headlineMedium),
                        const SizedBox(height: 2),
                        Text('Three quick choices. Change them anytime in Settings.',
                            style: text.bodyMedium?.copyWith(color: colors.inkSoft)),
                        const SizedBox(height: 14),
                        AppField(
                          label: 'Your name',
                          controller: _name,
                          required: true,
                          maxLength: 80,
                          enabled: !_saving,
                          textCapitalization: TextCapitalization.words,
                          autofillHints: const <String>[AutofillHints.name],
                        ),
                        _select<String>(
                          label: 'Exam',
                          value: _examId,
                          hint: 'Choose your exam',
                          items: examItems,
                          onChanged: (String? id) {
                            if (id != null) _chooseExam(catalog, id);
                          },
                        ),
                        if (exam != null) ...<Widget>[
                          _select<int>(
                            key: ValueKey<String>('year-${exam.id}'),
                            label: 'Target year',
                            value: _year,
                            hint: 'Choose a year',
                            items: <DropdownMenuItem<int>>[
                              for (final int y in years) DropdownMenuItem<int>(value: y, child: Text('$y')),
                            ],
                            onChanged: (int? y) => setState(() => _year = y),
                          ),
                          if (exam.sessions.isNotEmpty)
                            _select<String>(
                              key: ValueKey<String>('session-${exam.id}'),
                              label: exam.sessionLabel.isEmpty ? 'Attempt / session' : exam.sessionLabel,
                              value: _session,
                              hint: 'Choose one',
                              items: <DropdownMenuItem<String>>[
                                for (final String s in exam.sessions)
                                  DropdownMenuItem<String>(value: s, child: Text(s)),
                              ],
                              onChanged: (String? s) => setState(() => _session = s),
                            ),
                        ],
                        if (exam?.boardsAddon ?? false)
                          CheckboxListTile(
                            value: _addon,
                            onChanged: _saving ? null : (bool? v) => setState(() => _addon = v ?? false),
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            controlAffinity: ListTileControlAffinity.leading,
                            title: const Text('Also track my Class 12 boards'),
                          ),
                        if (needsBoard)
                          _select<String>(
                            key: ValueKey<String>('board-${exam?.id}-$_addon'),
                            label: exam!.boards.isNotEmpty ? 'Board' : 'Class 12 board',
                            value: boardChoices.contains(_board) ? _board : null,
                            hint: 'Choose a board',
                            items: <DropdownMenuItem<String>>[
                              for (final String b in boardChoices) DropdownMenuItem<String>(value: b, child: Text(b)),
                            ],
                            onChanged: (String? b) => setState(() => _board = b),
                          ),
                        if (subjects.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Text('Subjects: ${subjects.join(', ')}',
                                style: text.bodySmall?.copyWith(color: colors.muted)),
                          ),
                        Text('Appearance *', style: text.labelMedium?.copyWith(color: colors.palette.inkSoft)),
                        const SizedBox(height: 6),
                        Row(
                          children: <Widget>[
                            themeOption('light', Icons.wb_sunny_outlined, 'Light'),
                            const SizedBox(width: 8),
                            themeOption('dark', Icons.dark_mode_outlined, 'Dark'),
                          ],
                        ),
                        if (_problem != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: Semantics(
                              liveRegion: true,
                              child: Text(_problem!, style: text.bodySmall?.copyWith(color: colors.palette.red)),
                            ),
                          ),
                        const SizedBox(height: 14),
                        Align(
                          alignment: Alignment.centerRight,
                          child: ElevatedButton(
                            onPressed: _saving ? null : () => _submit(exam),
                            child: Text(_saving ? 'Saving…' : 'Start studying'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
