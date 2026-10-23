import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../logic/exam.dart';
import '../../logic/recommend.dart';
import '../shell/app_shell.dart';
import '../shell/routes.dart';

/// Study now: the deterministic ranking from logic/recommend.dart with the reasons behind
/// every suggestion. Nothing is generated — the same inputs produce the same order.
class StudyNowPage extends ConsumerWidget {
  const StudyNowPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final StrackerColors colors = context.stracker;
    final String today = todayIso();
    final StudyNowResult result = recommendStudyNow(data, today);
    final List<Recommendation> ranked = <Recommendation>[
      if (result.primary != null) result.primary!,
      ...result.alternatives,
    ];

    return SectionPage(
      title: 'What should I study now?',
      subtitle: result.examMode
          ? 'Exam mode on · ${examModeLabel(data, today)}'
          : 'Ranked from your backlog, revisions, cards and weak chapters',
      actions: <Widget>[
        IconButton(
          tooltip: 'Exam mode',
          icon: const Icon(Icons.bolt, size: 20),
          onPressed: () => Routes.open(context, Routes.settings),
        ),
      ],
      child: PageBody(
        refresh: () => ref.read(dataControllerProvider.notifier).load(silent: true),
        children: <Widget>[
          InfoBanner(
            result.examMode
                ? 'Exam mode is on, so revision, PYQ work and mocks are boosted by 1.35×. It turns on '
                    'by itself inside 30 days of your active exam date, or by hand in Settings.'
                : 'Suggestions are deterministic: each candidate gets a base score, an importance '
                    'factor and a small exam-mode boost. The top four reasons are shown with it.',
            icon: Icons.auto_awesome_outlined,
          ),
          const SizedBox(height: 10),
          if (ranked.isEmpty)
            NotebookCard(
              child: EmptyState(
                title: 'Nothing to rank yet',
                message: result.emptyReason ??
                    'Add a chapter, a revision, a flashcard or a backlog item and the ranking fills in.',
                icon: Icons.explore_outlined,
                action: ElevatedButton(
                  onPressed: () => Routes.open(context, Routes.syllabus),
                  child: const Text('Open syllabus'),
                ),
              ),
            )
          else
            for (int index = 0; index < ranked.length; index += 1)
              _RecommendationCard(
                recommendation: ranked[index],
                position: index + 1,
                primary: index == 0,
              ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Why this order',
            subtitle: 'Scores are relative to each other, not a predicted mark.',
            child: Column(
              children: <Widget>[
                for (final Recommendation recommendation in ranked)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: Row(
                      children: <Widget>[
                        SizedBox(
                          width: 56,
                          child: Text(
                            numberLabel(recommendation.score, digits: 1),
                            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                  color: colors.palette.textAccent,
                                ),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            recommendation.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        Pill(recommendation.kind.replaceAll('-', ' '), dense: true),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RecommendationCard extends StatelessWidget {
  const _RecommendationCard({
    required this.recommendation,
    required this.position,
    required this.primary,
  });

  final Recommendation recommendation;
  final int position;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: NotebookCard(
        accent: primary ? colors.palette.accent : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  width: 24,
                  height: 24,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: primary ? colors.palette.accent : colors.palette.paperMuted,
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    '$position',
                    style: TextStyle(
                      fontFamily: 'PatrickHand',
                      fontSize: 14,
                      color: primary ? Colors.white : colors.palette.inkSoft,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(recommendation.title, style: Theme.of(context).textTheme.titleLarge),
                ),
                Text(
                  numberLabel(recommendation.score, digits: 1),
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(color: colors.muted),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 5,
              runSpacing: 4,
              children: <Widget>[
                Pill(recommendation.kind.replaceAll('-', ' '), tone: PillTone.accent, dense: true),
                if (recommendation.subject != null)
                  Pill(recommendation.subject!, tone: PillTone.neutral, dense: true),
              ],
            ),
            const SizedBox(height: 7),
            Text(recommendation.summary, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 4),
            for (final String reason in recommendation.reasons.take(4))
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('·  ', style: TextStyle(color: colors.muted)),
                    Expanded(
                      child: Text(
                        reason,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.inkSoft),
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: () => Routes.open(context, recommendation.route),
              child: Text(recommendation.actionLabel),
            ),
          ],
        ),
      ),
    );
  }
}
