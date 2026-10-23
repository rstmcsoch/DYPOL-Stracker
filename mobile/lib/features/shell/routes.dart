import 'package:flutter/material.dart';

import '../ai/ai_chat_page.dart';
import '../analytics/analytics_page.dart';
import '../analytics/weak_areas_page.dart';
import '../backlog/backlog_page.dart';
import '../backup/backup_page.dart';
import '../decks/decks_page.dart';
import '../focus/focus_page.dart';
import '../mistakes/mistakes_page.dart';
import '../mock/mock_analysis_page.dart';
import '../planner/planner_page.dart';
import '../practice/practice_page.dart';
import '../profile/profile_page.dart';
import '../pyq/pyq_page.dart';
import '../retry/retry_page.dart';
import '../revision/revision_page.dart';
import '../settings/settings_page.dart';
import '../studynow/study_now_page.dart';
import '../syllabus/syllabus_page.dart';
import '../tests/tests_page.dart';

/// Route keys, exactly the website's paths (minus the leading slash). A recommendation or
/// a search result can therefore name the same destination the web app uses.
class Routes {
  const Routes._();

  static const String home = 'home';
  static const String syllabus = 'syllabus';
  static const String tests = 'tests';
  static const String practice = 'practice';
  static const String pyqs = 'pyqs';
  static const String mistakes = 'mistakes';
  static const String retry = 'retry';
  static const String planner = 'planner';
  static const String revision = 'revision';
  static const String analytics = 'analytics';
  static const String weakAreas = 'weak-areas';
  static const String mockAnalysis = 'mock-analysis';
  static const String backlog = 'backlog';
  static const String decks = 'decks';
  static const String focus = 'focus';
  static const String studyNow = 'study-now';
  static const String backup = 'backup';
  static const String settings = 'settings';
  static const String profile = 'profile';

  static Widget? pageFor(String key) => switch (key) {
        syllabus => const SyllabusPage(),
        tests => const TestsPage(),
        practice => const PracticePage(),
        pyqs => const PyqPage(),
        mistakes => const MistakesPage(),
        retry => const RetryPage(),
        planner => const PlannerPage(),
        revision => const RevisionPage(),
        analytics => const AnalyticsPage(),
        weakAreas => const WeakAreasPage(),
        mockAnalysis => const MockAnalysisPage(),
        backlog => const BacklogPage(),
        decks => const DecksPage(),
        focus => const FocusPage(),
        studyNow => const StudyNowPage(),
        backup => const BackupPage(),
        settings => const SettingsPage(),
        profile => const ProfilePage(),
        'ai' || 'assistant' => const AiChatPage(),
        _ => null,
      };

  /// Pushes a section on top of the shell, so Android's back button returns to the tab the
  /// student came from.
  static Future<void> open(BuildContext context, String key) async {
    final Widget? page = pageFor(key);
    if (page == null) return;
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));
  }
}
