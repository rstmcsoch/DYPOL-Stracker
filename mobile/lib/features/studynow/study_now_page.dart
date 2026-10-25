import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../logic/home_summary.dart';
import '../../logic/readiness.dart';
import '../../logic/recommend.dart';
import '../../logic/reminders.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// Website `StudyNowPage`: the Study now card with "Why this?", Exam Mode, per-track
/// readiness and the reminders that apply right now. Everything is computed from the
/// user's own records; nothing is generated.
class StudyNowPage extends ConsumerWidget {
  const StudyNowPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final String today = todayIso();
    final StudyNowResult result = recommendStudyNow(data, today);
    final ExamModeState mode = examModeState(data, today);
    final List<TrackReadiness> tracks = allTrackReadiness(data, today);
    final List<ReminderItem> reminders = computeReminders(data, today);

    return SectionPage(
      title: 'Study now',
      subtitle: 'Your most urgent item, and why.',
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          StudyNowFullCard(result: result, examLabel: mode.label),
          _NotedHeading(
            title: 'Exam Mode',
            note: mode.reason,
            action: OutlinedButton.icon(
              onPressed: () => Routes.open(context, Routes.settings),
              icon: const Icon(Icons.tune, size: 15),
              label: const Text('Exam settings'),
            ),
          ),
          NotebookCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    Pill(mode.active ? 'On' : 'Off', tone: mode.active ? PillTone.bad : PillTone.neutral, dense: true),
                    Text(mode.label.isEmpty ? 'No active track' : mode.label, style: text.titleSmall),
                    Text(countdownForDays(mode.daysLeft), style: text.labelSmall?.copyWith(color: colors.muted)),
                  ],
                ),
                if (mode.active) ...<Widget>[
                  const SizedBox(height: 8),
                  Text(
                    'While Exam Mode is on, revision, PYQs, mocks, flashcards and weak-area fixes are weighted up. '
                    'New theory is not suggested, and backlog only surfaces when it is due or high priority.',
                    style: text.bodySmall,
                  ),
                ],
              ],
            ),
          ),
          const _NotedHeading(title: 'Track readiness', note: 'Each track is measured against its own PYQs.'),
          WrapGrid(
            minItemWidth: 220,
            children: <Widget>[for (final TrackReadiness track in tracks) _TrackCard(track: track)],
          ),
          if (reminders.isNotEmpty) ...<Widget>[
            const _NotedHeading(title: 'Reminders right now', note: 'Change in Settings → Study rhythm.'),
            NotebookCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  for (final ReminderItem item in reminders)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Pill(reminderLabel[item.kind] ?? item.kind, dense: true),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text.rich(
                              TextSpan(
                                children: <InlineSpan>[
                                  TextSpan(
                                    text: '${item.title}. ',
                                    style: const TextStyle(fontWeight: FontWeight.w700),
                                  ),
                                  TextSpan(text: item.body),
                                ],
                              ),
                              style: text.bodySmall,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Website `StudyNowCard` (full mode): kicker, Exam Mode badge, the top item with its
/// action, a "Why this?" toggle with the reasons and alternatives, and "Next up".
class StudyNowFullCard extends StatefulWidget {
  const StudyNowFullCard({super.key, required this.result, this.examLabel});

  final StudyNowResult result;
  final String? examLabel;

  @override
  State<StudyNowFullCard> createState() => _StudyNowFullCardState();
}

class _StudyNowFullCardState extends State<StudyNowFullCard> {
  bool _showWhy = false;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final StudyNowResult result = widget.result;
    final Recommendation? primary = result.primary;
    final String? label = widget.examLabel;
    return NotebookCard(
      accent: colors.palette.accent,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(Icons.explore_outlined, size: 15, color: colors.muted),
                  const SizedBox(width: 4),
                  Text(
                    'PLANNING',
                    style:
                        text.labelSmall?.copyWith(color: colors.muted, letterSpacing: 1.3, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
              if (result.examMode)
                Pill(
                  'Exam Mode${label != null && label.isNotEmpty ? ' · $label' : ''}',
                  tone: PillTone.bad,
                  icon: Icons.local_fire_department_outlined,
                  dense: true,
                ),
            ],
          ),
          const SizedBox(height: 6),
          Semantics(header: true, child: Text('What should I study now?', style: text.titleLarge)),
          const SizedBox(height: 6),
          if (primary == null)
            Text(result.emptyReason ?? '', style: text.bodyMedium?.copyWith(color: colors.muted))
          else ...<Widget>[
            Text(primary.summary, style: text.bodyMedium),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                ElevatedButton(
                  onPressed: () => Routes.open(context, primary.route),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Flexible(child: Text(primary.actionLabel)),
                      const SizedBox(width: 6),
                      const Icon(Icons.arrow_forward, size: 15),
                    ],
                  ),
                ),
                TextButton.icon(
                  onPressed: () {
                    HapticFeedback.selectionClick();
                    setState(() => _showWhy = !_showWhy);
                  },
                  icon: Icon(_showWhy ? Icons.expand_less : Icons.expand_more, size: 16),
                  label: const Text('Why this?'),
                ),
              ],
            ),
            AnimatedSize(
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOutCubic,
              alignment: Alignment.topCenter,
              child: _showWhy
                  ? _WhyList(primary: primary, alternatives: result.alternatives)
                  : const SizedBox(width: double.infinity),
            ),
            if (result.alternatives.isNotEmpty && !_showWhy)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Next up: ${result.alternatives.take(2).map((Recommendation item) => item.title).join(' · ')}',
                  style: text.labelSmall?.copyWith(color: colors.muted),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _WhyList extends StatelessWidget {
  const _WhyList({required this.primary, required this.alternatives});

  final Recommendation primary;
  final List<Recommendation> alternatives;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Ranked highest because:', style: text.titleSmall),
          const SizedBox(height: 4),
          for (final String reason in primary.reasons)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text('•  $reason', style: text.bodySmall),
            ),
          if (alternatives.isNotEmpty) ...<Widget>[
            const SizedBox(height: 8),
            Text('Also in the running', style: text.titleSmall),
            const SizedBox(height: 4),
            for (int index = 0; index < alternatives.length; index += 1)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('${index + 1}. ${alternatives[index].title}', style: text.bodySmall),
                    Padding(
                      padding: const EdgeInsets.only(left: 16),
                      child: Text(
                        alternatives[index].reasons.isEmpty
                            ? alternatives[index].summary
                            : alternatives[index].reasons.join('; '),
                        style: text.labelSmall?.copyWith(color: colors.muted),
                      ),
                    ),
                  ],
                ),
              ),
          ],
          const SizedBox(height: 6),
          Text(
            'Ranking is deterministic: overdue revisions, due backlog, due flashcards, mistakes awaiting retry, '
            'weak practice or test chapters, pending PYQs, and mock losses, weighted by chapter importance.',
            style: text.labelSmall?.copyWith(color: colors.muted),
          ),
        ],
      ),
    );
  }
}

class _TrackCard extends StatelessWidget {
  const _TrackCard({required this.track});

  final TrackReadiness track;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final double? percent = track.percent;
    return NotebookCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(child: Text(track.label, style: text.titleSmall)),
              const SizedBox(width: 6),
              Text(countdownForDays(track.daysLeft), style: text.labelSmall?.copyWith(color: colors.muted)),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            percentLabel(percent),
            style: text.headlineSmall?.copyWith(color: percent == null ? colors.muted : null),
          ),
          const SizedBox(height: 6),
          LinearBar(
            value: percent == null ? 0 : (percent.clamp(0, 100) / 100),
            color: track.track == 'boards' ? colors.palette.green : colors.palette.accent,
            label: '${track.label} readiness',
          ),
          const SizedBox(height: 8),
          for (final ReadinessPart part in track.components)
            Padding(
              padding: const EdgeInsets.only(bottom: 5),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(part.label, style: text.bodySmall),
                        Text(part.note, style: text.labelSmall?.copyWith(color: colors.muted)),
                      ],
                    ),
                  ),
                  Text(
                    percentLabel(part.value),
                    style: text.titleSmall?.copyWith(color: part.value == null ? colors.muted : null),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Website `SectionHeading` with a note line and an optional action.
class _NotedHeading extends StatelessWidget {
  const _NotedHeading({required this.title, this.note, this.action});

  final String title;
  final String? note;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 16, 2, 8),
      child: Wrap(
        spacing: 8,
        runSpacing: 6,
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Semantics(header: true, child: Text(title, style: text.titleMedium)),
              if (note != null && note!.isNotEmpty)
                Text(note!, style: text.labelSmall?.copyWith(color: context.stracker.muted)),
            ],
          ),
          if (action != null) action!,
        ],
      ),
    );
  }
}
