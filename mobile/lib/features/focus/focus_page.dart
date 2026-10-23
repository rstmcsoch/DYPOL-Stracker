import 'dart:async';

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
import '../shell/app_shell.dart';

/// Focus timer. Counts real elapsed seconds, works while the app is in the foreground,
/// and writes a `study_sessions` row with `completion_state` `completed` or `abandoned`
/// — the same shape the website's focus page writes.
class FocusPage extends ConsumerStatefulWidget {
  const FocusPage({super.key});

  @override
  ConsumerState<FocusPage> createState() => _FocusPageState();
}

class _FocusPageState extends ConsumerState<FocusPage> with WidgetsBindingObserver {
  static const int _pomodoroSeconds = 25 * 60;

  int _total = _pomodoroSeconds;
  int _remaining = _pomodoroSeconds;
  bool _running = false;
  Timer? _ticker;
  DateTime? _startedAt;
  String _activity = 'Practice';
  String? _subject;
  String? _chapterId;
  int _sessionsToday = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _ticker?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The timer is wall-clock based, so a background pause does not distort the result;
    // we only stop ticking to avoid needless wakeups.
    if (state == AppLifecycleState.paused && _running) {
      _ticker?.cancel();
      _ticker = null;
    } else if (state == AppLifecycleState.resumed && _running) {
      _startTicker();
      _recompute();
    }
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _recompute());
  }

  void _recompute() {
    final DateTime? started = _startedAt;
    if (started == null) return;
    final int elapsed = DateTime.now().difference(started).inSeconds;
    final int remaining = _total - elapsed;
    if (remaining <= 0) {
      setState(() {
        _remaining = 0;
        _running = false;
      });
      _ticker?.cancel();
      _ticker = null;
      _finish('completed', _total);
      return;
    }
    setState(() => _remaining = remaining);
  }

  void _start() {
    setState(() {
      _running = true;
      _startedAt = DateTime.now();
      _remaining = _total;
    });
    _startTicker();
  }

  void _pause() {
    setState(() => _running = false);
    _ticker?.cancel();
    _ticker = null;
  }

  void _reset() {
    _ticker?.cancel();
    _ticker = null;
    setState(() {
      _running = false;
      _startedAt = null;
      _remaining = _total;
    });
  }

  Future<void> _stopAndSave() async {
    final DateTime? started = _startedAt;
    if (started == null) return;
    final int elapsedMinutes = DateTime.now().difference(started).inMinutes;
    if (elapsedMinutes < 1) {
      showToast(context, 'Less than a minute — nothing to save.');
      return;
    }
    final bool confirmed = await confirmAction(
      context,
      title: 'End this session?',
      message: '${minutesLabel(elapsedMinutes)} will be saved as an abandoned session, which still '
          'counts towards study time (the website does the same).',
      confirmLabel: 'End and save',
    );
    if (!confirmed) return;
    await _finish('abandoned', elapsedMinutes);
    _reset();
  }

  Future<void> _finish(String state, int minutes) async {
    final AppData data = ref.read(dataControllerProvider).data;
    final DateTime? started = _startedAt;
    final StudySession session = StudySession(
      id: newId(),
      userId: data.userId,
      subject: _subject,
      chapterId: _chapterId,
      startedAt: (started ?? DateTime.now()).toUtc().toIso8601String(),
      endedAt: isoNow(),
      durationMinutes: minutes,
      completionState: state,
      mode: 'Pomodoro',
      activity: _activity,
      createdAt: isoNow(),
      updatedAt: isoNow(),
    );
    try {
      await ref.read(dataControllerProvider.notifier).saveSession(session);
      if (!mounted) return;
      setState(() => _sessionsToday += 1);
      showToast(
        context,
        state == 'completed'
            ? 'Session complete. ${minutesLabel(minutes)} recorded.'
            : '${minutesLabel(minutes)} recorded as abandoned.',
      );
    } catch (error) {
      if (mounted) showToast(context, error.toString(), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final StudyTotals totals = studyTotals(data);
    final double progress = _total == 0 ? 0 : (_total - _remaining) / _total;
    final int minutes = _remaining ~/ 60;
    final int seconds = _remaining % 60;

    return SectionPage(
      title: 'Focus',
      subtitle: '${minutesLabel(totals.todayMinutes)} studied today · ${totals.streak} day streak',
      actions: <Widget>[
        IconButton(
          tooltip: 'Focus settings',
          icon: const Icon(Icons.tune, size: 20),
          onPressed: () => _pickLength(),
        ),
      ],
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          NotebookCard(
            padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 14),
            child: Column(
              children: <Widget>[
                ProgressRing(
                  value: progress * 100,
                  size: 210,
                  stroke: 12,
                  center: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        '${two(minutes)}:${two(seconds)}',
                        style: TextStyle(
                          fontFamily: 'PatrickHand',
                          fontSize: 54,
                          height: 1,
                          color: colors.palette.ink,
                          fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _running ? 'focusing' : (_startedAt == null ? 'ready' : 'paused'),
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    if (!_running)
                      FilledButton.icon(
                        onPressed: _startedAt == null ? _start : _start,
                        icon: const Icon(Icons.play_arrow, size: 19),
                        label: Text(_startedAt == null ? 'Start ${_total ~/ 60} min' : 'Resume'),
                      )
                    else
                      FilledButton.icon(
                        onPressed: _pause,
                        icon: const Icon(Icons.pause, size: 19),
                        label: const Text('Pause'),
                      ),
                    const SizedBox(width: 8),
                    OutlinedButton.icon(
                      onPressed: _running || _startedAt != null ? _stopAndSave : _reset,
                      icon: const Icon(Icons.stop, size: 18),
                      label: Text(_startedAt == null ? 'Reset' : 'End'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'What are you focusing on?',
            subtitle: 'Stored on the session row, so the website’s analytics can use it.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                AppSelect<String>(
                  label: 'Activity',
                  value: _activity,
                  items: const <String>[
                    'Lecture',
                    'Practice',
                    'Revision',
                    'Mock/Test',
                    'PYQ practice',
                  ],
                  onChanged: (String? value) {
                    if (_running) {
                      showToast(context, 'Pause before changing the activity.');
                      return;
                    }
                    setState(() => _activity = value ?? _activity);
                  },
                ),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: AppSelect<String?>(
                        label: 'Subject',
                        value: _subject,
                        items: <String?>[null, ...data.subjects],
                        labelFor: (String? value) => value ?? 'Any',
                        onChanged: (String? value) => setState(() => _subject = value),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: AppSelect<String?>(
                        label: 'Chapter',
                        value: _chapterId,
                        items: <String?>[null, ...data.chapters.map((Chapter chapter) => chapter.id)],
                        labelFor: (String? value) =>
                            value == null ? 'None' : data.chapterName(value),
                        onChanged: (String? value) => setState(() => _chapterId = value),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: <Widget>[
              Expanded(
                child: StatTile(
                  value: '${_sessionsToday + data.sessions.where((StudySession session) => session.startedAt.startsWith(todayIso())).length}',
                  label: 'Sessions today',
                  hint: 'completed and abandoned',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: StatTile(
                  value: minutesLabel(totals.todayMinutes),
                  label: 'Minutes today',
                  hint: 'goal ${minutesLabel(data.settings.dailyStudyGoalMinutes)}',
                  tone: totals.todayMinutes >= data.settings.dailyStudyGoalMinutes
                      ? colors.palette.green
                      : null,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          InfoBanner(
            'The timer keeps the real elapsed time, so pausing the app (or the screen) cannot inflate a '
            'session. Nothing runs while the timer is stopped, and no background service is used.',
            icon: Icons.timer_outlined,
          ),
        ],
      ),
    );
  }

  Future<void> _pickLength() async {
    if (_running) {
      showToast(context, 'Pause first.');
      return;
    }
    final int? minutes = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: context.stracker.palette.paper,
      builder: (BuildContext sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            for (final int option in <int>[15, 25, 30, 45, 60, 90])
              ListTile(
                title: Text('$option minutes'),
                trailing: _total ~/ 60 == option ? const Icon(Icons.check, size: 18) : null,
                onTap: () => Navigator.of(sheetContext).pop(option),
              ),
          ],
        ),
      ),
    );
    if (minutes == null) return;
    setState(() {
      _total = minutes * 60;
      _remaining = _total;
      _startedAt = null;
    });
  }
}
