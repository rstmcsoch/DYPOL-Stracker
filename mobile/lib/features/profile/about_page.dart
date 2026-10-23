import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/notebook.dart';
import '../shell/app_shell.dart';

/// The app's own "About" page. Every sentence here is the website's public copy, not an
/// implementation note: no product names, no infrastructure, no server details.
class AboutPage extends StatelessWidget {
  const AboutPage({super.key});

  static const List<(String, String)> _loop = <(String, String)>[
    ('Learn', 'Work the syllabus chapter by chapter, with notes and formulas on the same page as the status.'),
    ('Test', 'Log the chapter test, subject test, mock or previous-year paper while it is still in front of you.'),
    ('Analyse', 'Read the marks, the error mix and the chapter signals instead of guessing where the score went.'),
    ('Revise', 'Let the intervals and the due desk bring each chapter back — including the ones that keep slipping.'),
    ('Repeat', 'Fold the result into tomorrow’s tasks and this week’s goals, then start the next cycle.'),
  ];

  static const List<(IconData, String, String)> _parts = <(IconData, String, String)>[
    (Icons.menu_book_outlined, 'Syllabus notebook', 'Chapters, weights, notes and formula notes in one place.'),
    (Icons.assignment_outlined, 'Tests', 'Chapter, subject and full-syllabus papers with subject scores.'),
    (Icons.error_outline, 'Mistakes', 'A mistake log with the solution, the reason and a retry desk.'),
    (Icons.event_repeat_outlined, 'Revision', 'Spaced intervals that decide what is due today.'),
    (Icons.today_outlined, 'Planner & goals', 'Today’s tasks and this week’s targets.'),
    (Icons.insights_outlined, 'Analytics', 'Trends, weak areas and a mock-paper breakdown.'),
    (Icons.timer_outlined, 'Focus', 'Timed study blocks that feed the same record.'),
    (Icons.style_outlined, 'Decks', 'Quick-recall cards for the chapters you keep forgetting.'),
  ];

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return SectionPage(
      title: 'About Stracker',
      subtitle: 'DYPOL LABS',
      child: PageBody(
        children: <Widget>[
          Text(
            'FOR EVERY EXAM · A DIGITAL STUDY NOTEBOOK',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: colors.muted,
                  letterSpacing: 1.4,
                ),
          ),
          const SizedBox(height: 8),
          Text('Your exam preparation, organized in one serious study notebook.',
              style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 8),
          Text(
            'Syllabus, tests, mistakes, revision, daily plan and analytics on one page — then it '
            'stays quiet while you study.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: colors.inkSoft),
          ),
          const SizedBox(height: 16),
          NotebookCard(
            title: 'A study loop built on evidence',
            subtitle: 'Learn → Test → Analyse → Revise → Repeat',
            child: Column(
              children: <Widget>[
                for (int index = 0; index < _loop.length; index += 1)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Container(
                          width: 24,
                          height: 24,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: colors.palette.accentLight,
                            shape: BoxShape.circle,
                          ),
                          child: Text(
                            '${index + 1}',
                            style: TextStyle(
                              fontFamily: 'PatrickHand',
                              fontSize: 13,
                              color: colors.palette.textAccent,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(_loop[index].$1, style: Theme.of(context).textTheme.titleSmall),
                              Text(
                                _loop[index].$2,
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Inside the notebook',
            child: Column(
              children: <Widget>[
                for (final (IconData, String, String) part in _parts)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Icon(part.$1, size: 18, color: colors.palette.accent),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(part.$2, style: Theme.of(context).textTheme.titleSmall),
                              Text(
                                part.$3,
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          NotebookCard(
            title: 'Your preparation stays yours',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  'Your records stay yours: your account, your pages, nothing shared.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.inkSoft),
                ),
                const SizedBox(height: 8),
                Text(
                  'No ads, no third-party trackers. Sign in on the phone and the same notebook '
                  'opens on the web.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Center(
            child: Text(
              'Stracker · DYPOL LABS · Version 1.0.0',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
            ),
          ),
        ],
      ),
    );
  }
}
