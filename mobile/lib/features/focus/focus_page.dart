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
import '../../logic/focus.dart';
import 'focus_controller.dart';
import '../shell/app_shell.dart';

/// Focus page. The timer itself lives in [focusControllerProvider], so a block keeps
/// running or stays paused while the student uses other screens (Home shows it), and the
/// elapsed time is measured from timestamps across every pause. Ending early asks to save
/// or discard; a saved partial block is a `study_sessions` row with `completion_state`
/// `interrupted` and a natural finish is `completed` — the same shape the website writes.
class FocusPage extends ConsumerStatefulWidget {
  const FocusPage({super.key});

  @override
  ConsumerState<FocusPage> createState() => _FocusPageState();
}

enum _EndChoice { save, discard, keep }

class _FocusPageState extends ConsumerState<FocusPage> {
  bool _dialogOpen = false;

  FocusController get _focus => ref.read(focusControllerProvider.notifier);

  /// One confirmation for End: save the real elapsed minutes, discard, or keep studying.
  Future<void> _end() async {
    if (_dialogOpen) return;
    final FocusTimerState current = ref.read(focusControllerProvider);
    final int seconds = current.elapsedAt(DateTime.now());
    final int minutes = loggableMinutes(seconds);
    _dialogOpen = true;
    final _EndChoice? choice = await showDialog<_EndChoice>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        backgroundColor: context.stracker.palette.paper,
        title: Text(
          minutes >= 1 ? 'Save $minutes min of study time?' : 'Less than a minute studied',
          style: Theme.of(dialogContext).textTheme.headlineSmall,
        ),
        content: Text(
          minutes >= 1
              ? 'You studied ${focusClock(seconds)} in this block. Save it to your study time, or discard it.'
              : 'Blocks under a minute are not recorded. You can discard it or keep studying.',
          style: Theme.of(dialogContext).textTheme.bodyMedium,
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(_EndChoice.keep),
            child: const Text('Keep studying'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(_EndChoice.discard),
            child: const Text('Discard & end'),
          ),
          FilledButton(
            onPressed: minutes >= 1 ? () => Navigator.of(dialogContext).pop(_EndChoice.save) : null,
            child: const Text('Save & end'),
          ),
        ],
      ),
    );
    _dialogOpen = false;
    if (!mounted || choice == null || choice == _EndChoice.keep) return;
    final FocusSaveResult result = await _focus.end(save: choice == _EndChoice.save);
    if (!mounted) return;
    if (result.error != null) {
      showToast(context, result.error!, error: true);
    } else if (choice == _EndChoice.save && result.minutes > 0) {
      showToast(context, '${minutesLabel(result.minutes)} saved to your study time.');
    } else if (choice == _EndChoice.discard) {
      showToast(context, 'Block discarded. Nothing was recorded.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final FocusTimerState timer = ref.watch(focusControllerProvider);
    final StrackerColors colors = context.stracker;
    final StudyTotals totals = studyTotals(data);
    final DateTime now = DateTime.now();
    final int total = timer.totalSeconds;
    final int remaining = timer.remainingAt(now);
    final int elapsed = timer.elapsedAt(now);
    final bool running = timer.running;
    final bool unsaved = timer.hasUnsavedAt(now);
    final double progress = total == 0 ? 0 : (total - remaining) / total;
    final int minutes = remaining ~/ 60;
    final int seconds = remaining % 60;

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
                        running ? 'focusing' : (unsaved ? 'paused' : (timer.finished ? 'block complete' : 'ready')),
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                      ),
                    ],
                  ),
                ),
                if (running || unsaved) ...<Widget>[
                  const SizedBox(height: 10),
                  Text(
                    'Elapsed ${focusClock(elapsed)} · Remaining ${focusClock(remaining)}',
                    key: const ValueKey<String>('focus-elapsed-line'),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: colors.palette.ink,
                          fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
                        ),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    if (!running)
                      FilledButton.icon(
                        onPressed: _focus.start,
                        icon: const Icon(Icons.play_arrow, size: 19),
                        label: Text(unsaved ? 'Resume' : 'Start ${total ~/ 60} min'),
                      )
                    else
                      FilledButton.icon(
                        onPressed: _focus.pause,
                        icon: const Icon(Icons.pause, size: 19),
                        label: const Text('Pause'),
                      ),
                    if (unsaved) ...<Widget>[
                      const SizedBox(width: 8),
                      OutlinedButton.icon(
                        onPressed: _end,
                        icon: const Icon(Icons.stop, size: 18),
                        label: const Text('End'),
                      ),
                    ],
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
                  value: timer.activity,
                  items: const <String>[
                    'Lecture',
                    'Practice',
                    'Revision',
                    'Mock/Test',
                    'PYQ practice',
                  ],
                  onChanged: (String? value) {
                    if (running) {
                      showToast(context, 'Pause before changing the activity.');
                      return;
                    }
                    if (value != null) _focus.setActivity(value);
                  },
                ),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: AppSelect<String?>(
                        label: 'Subject',
                        value: timer.subject,
                        items: <String?>[null, ...data.subjects],
                        labelFor: (String? value) => value ?? 'Any',
                        onChanged: (String? value) => _focus.setSubject(value),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: AppSelect<String?>(
                        label: 'Chapter',
                        value: timer.chapterId,
                        items: <String?>[null, ...data.chapters.map((Chapter chapter) => chapter.id)],
                        labelFor: (String? value) =>
                            value == null ? 'None' : data.chapterName(value),
                        onChanged: (String? value) => _focus.setChapter(value),
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
                  value: '${data.sessions.where((StudySession session) => countsAsStudyTime(session) && isoDate(DateTime.parse(session.startedAt).toUtc().add(const Duration(hours: 5, minutes: 30))) == todayIso()).length}',
                  label: 'Sessions today',
                  hint: 'finished and saved early',
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
            'session. It keeps going if you open another screen — Home shows it until you end the block.',
            icon: Icons.timer_outlined,
          ),
        ],
      ),
    );
  }

  Future<void> _pickLength() async {
    final FocusTimerState timer = ref.read(focusControllerProvider);
    if (timer.started) {
      showToast(context, 'End this block before changing its length.');
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
                trailing: timer.totalSeconds ~/ 60 == option ? const Icon(Icons.check, size: 18) : null,
                onTap: () => Navigator.of(sheetContext).pop(option),
              ),
          ],
        ),
      ),
    );
    if (minutes == null) return;
    _focus.setLength(minutes);
  }
}
