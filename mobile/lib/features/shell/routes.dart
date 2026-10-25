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
import '../search/search_focus.dart';
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

  /// The shell's content-area navigator, set while the [AppShell] is mounted. Sections open
  /// inside it, so the floating bottom bar (phones, portrait tablets) or the sidebar
  /// (landscape tablets) stays in place, as on the website. Null outside the shell (tests,
  /// sign-in), where the nearest navigator is used.
  static GlobalKey<NavigatorState>? contentNavigator;

  /// Opens a section. Android's back returns to where the student came from. From the
  /// drawer or sidebar ([fromMenu]) the section replaces any open one instead of stacking,
  /// like following a link in the website's menu.
  ///
  /// [focus] is the item a notebook search result points at; the section scrolls to it
  /// and highlights it.
  static Future<void> open(BuildContext context, String key, {bool fromMenu = false, SearchFocus? focus}) async {
    final Widget? page = pageFor(key);
    if (page == null) return;
    final NavigatorState navigator = contentNavigator?.currentState ?? Navigator.of(context);
    if (fromMenu) navigator.popUntil((Route<dynamic> route) => route.isFirst);
    await navigator.push(MaterialPageRoute<void>(
      builder: (_) => focus == null ? page : SearchFocusScope(focus: focus, child: page),
      settings: RouteSettings(name: key),
    ));
  }
}
