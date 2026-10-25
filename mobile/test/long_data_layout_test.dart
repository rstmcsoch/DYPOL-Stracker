import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stracker/core/theme/app_theme.dart';
import 'package:stracker/core/theme/palettes.dart';
import 'package:stracker/core/theme/theme_controller.dart';
import 'package:stracker/core/widgets/dialogs.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/repository.dart';
import 'package:stracker/features/analytics/analytics_page.dart';
import 'package:stracker/features/analytics/weak_areas_page.dart';
import 'package:stracker/features/backlog/backlog_page.dart';
import 'package:stracker/features/backup/backup_page.dart';
import 'package:stracker/features/decks/decks_page.dart';
import 'package:stracker/features/focus/focus_page.dart';
import 'package:stracker/features/home/home_page.dart';
import 'package:stracker/features/mistakes/mistakes_page.dart';
import 'package:stracker/features/mock/mock_analysis_page.dart';
import 'package:stracker/features/planner/planner_page.dart';
import 'package:stracker/features/practice/practice_page.dart';
import 'package:stracker/features/profile/profile_page.dart';
import 'package:stracker/features/pyq/pyq_page.dart';
import 'package:stracker/features/retry/retry_page.dart';
import 'package:stracker/features/revision/revision_page.dart';
import 'package:stracker/features/settings/settings_page.dart';
import 'package:stracker/features/shell/app_shell.dart';
import 'package:stracker/features/splash/splash_page.dart';
import 'package:stracker/features/studynow/study_now_page.dart';
import 'package:stracker/features/syllabus/syllabus_page.dart';
import 'package:stracker/features/tests/tests_page.dart';
import 'package:stracker/main.dart' show preferencesProvider;
import 'package:supabase_flutter/supabase_flutter.dart';

/// Layout checks with a full, wordy notebook: long names and notes, many chapters, tests,
/// mistakes, tasks and revisions. Values stay inside the database's check constraints.
const List<(String, Size)> _sizes = <(String, Size)>[
  ('phone 360x780', Size(360, 780)),
  ('phone 412x915', Size(412, 915)),
  ('phone 430x932', Size(430, 932)),
  ('phone landscape 915x412', Size(915, 412)),
  ('tablet portrait 800x1280', Size(800, 1280)),
  ('tablet landscape 1280x800', Size(1280, 800)),
];

const String _user = 'u1';

String _day(int offset) {
  final DateTime d = DateTime.now().add(Duration(days: offset));
  return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

String _stamp(int offset) => '${_day(offset)}T09:30:00.000Z';

Map<String, dynamic> _row(String id, Map<String, dynamic> fields) => <String, dynamic>{
      'id': id,
      'user_id': _user,
      'created_at': _stamp(-40),
      'updated_at': _stamp(-1),
      ...fields,
    };

String _snapshot() {
  const List<String> subjects = <String>['Physics', 'Chemistry', 'Mathematics'];
  const List<String> names = <String>[
    'Electromagnetic Induction and Alternating Current Circuits with Transformers',
    'Coordination Compounds, Isomerism and Crystal Field Theory (Werner, VBT, CFT)',
    'Definite Integration, Area Under Curves and Differential Equations of First Order',
    'Rotational Motion',
    'Thermodynamics and Kinetic Theory of Gases including Heat Transfer and Calorimetry',
    'Hydrocarbons',
  ];
  const List<String> statuses = <String>['Not Started', 'Studying', 'Done', 'Revised'];
  const List<String> priorities = <String>['High', 'Medium', 'Low'];
  const String note = 'Revisit the derivations twice; the coaching sheet skipped the edge cases with '
      'non-uniform fields and the sign convention for induced EMF in rotating loops keeps tripping me up.';
  final List<Map<String, dynamic>> chapters = <Map<String, dynamic>>[
    for (int i = 0; i < 36; i++)
      _row('c$i', <String, dynamic>{
        'subject': subjects[i % 3],
        'name': '${names[i % names.length]} ${i ~/ names.length + 1}',
        'position': i,
        'status': statuses[i % 4],
        'priority': priorities[i % 3],
        'importance': priorities[i % 3].toLowerCase(),
        'weightage': (i % 7) + 1,
        'notes': i.isEven ? note : null,
        'formula_notes': i % 3 == 0 ? note : null,
        'completed_on': i % 4 >= 2 ? _day(-i) : null,
      }),
  ];
  const List<String> testTypes = <String>['Chapter Test', 'Subject Test', 'Full Mock', 'PYQ Practice'];
  final List<Map<String, dynamic>> tests = <Map<String, dynamic>>[
    for (int i = 0; i < 18; i++)
      _row('t$i', <String, dynamic>{
        'title': 'All India Test Series — Full Syllabus Mock Paper ${i + 1} (Shift 2, revised pattern)',
        'test_date': _day(-i * 3),
        'test_type': testTypes[i % 4],
        'subject': i % 4 == 2 ? null : subjects[i % 3],
        'chapter_id': i % 4 == 0 ? 'c${i % 36}' : null,
        'marks_obtained': 120 + i * 7,
        'total_marks': 300,
        'correct': 40 + i,
        'wrong': 12 + (i % 5),
        'skipped': 8,
        'total_questions': 75,
        'negative_marks': 12 + (i % 5),
        'time_minutes': 180,
        'notes': note,
      }),
  ];
  const List<String> mistakeTypes = <String>['Concept', 'Silly', 'Calculation', 'Time', 'Guess'];
  final List<Map<String, dynamic>> mistakes = <Map<String, dynamic>>[
    for (int i = 0; i < 24; i++)
      _row('m$i', <String, dynamic>{
        'chapter_id': 'c${i % 36}',
        'test_id': 't${i % 18}',
        'mistake_type': mistakeTypes[i % 5],
        'question_note': 'Q${i + 14}: $note',
        'solution_note': note,
        'retry_later': i.isEven,
        'retry_status': i % 4 == 0 ? 'retried' : 'pending',
      }),
  ];
  final List<Map<String, dynamic>> revisions = <Map<String, dynamic>>[
    for (int i = 0; i < 20; i++)
      _row('r$i', <String, dynamic>{
        'chapter_id': 'c${(i * 2) % 36}',
        'revision_number': (i % 4) + 1,
        'due_on': _day(i - 6),
        'completed_at': i % 5 == 0 ? _stamp(i - 6) : null,
      }),
  ];
  final List<Map<String, dynamic>> tasks = <Map<String, dynamic>>[
    for (int i = 0; i < 14; i++)
      _row('d$i', <String, dynamic>{
        'title': 'Finish the second half of the module exercise on ${names[i % names.length]} and mark doubts',
        'subject': subjects[i % 3],
        'chapter_id': 'c$i',
        'topic': 'Level 2 and archive questions with the tricky multi-concept problems',
        'estimated_minutes': 90,
        'priority': priorities[i % 3],
        'is_completed': i % 3 == 0,
        'task_date': _day(i % 3 - 1),
        'position': i,
      }),
  ];
  const List<String> backlogTypes = <String>['Lecture', 'DPP', 'Topic'];
  final List<Map<String, dynamic>> backlog = <Map<String, dynamic>>[
    for (int i = 0; i < 16; i++)
      _row('b$i', <String, dynamic>{
        'title': 'Lecture ${i + 12} of ${names[i % names.length]} — includes the long problem-solving session',
        'type': backlogTypes[i % 3],
        'subject': subjects[i % 3],
        'chapter_id': 'c$i',
        'priority': priorities[i % 3],
        'due_on': _day(i - 8),
        'status': i % 5 == 4 ? 'done' : 'active',
        'notes': note,
      }),
  ];
  const List<String> activities = <String>['Lecture', 'Practice', 'Revision', 'Mock/Test', 'PYQ practice'];
  final List<Map<String, dynamic>> sessions = <Map<String, dynamic>>[
    for (int i = 0; i < 30; i++)
      _row('s$i', <String, dynamic>{
        'subject': subjects[i % 3],
        'chapter_id': 'c${i % 36}',
        'started_at': _stamp(-(i ~/ 2)),
        'ended_at': _stamp(-(i ~/ 2)),
        'duration_minutes': 25 + (i % 4) * 20,
        'completion_state': 'completed',
        'mode': 'Pomodoro',
        'activity': activities[i % 5],
      }),
  ];
  const List<String> sources = <String>['DPP', 'Module', 'Practice sheet', 'Coaching material', 'Other'];
  final List<Map<String, dynamic>> practice = <Map<String, dynamic>>[
    for (int i = 0; i < 20; i++)
      _row('p$i', <String, dynamic>{
        'chapter_id': 'c${i % 36}',
        'practice_date': _day(-i),
        'attempted': 30,
        'correct': 10 + i % 15,
        'incorrect': 20 - i % 15,
        'skipped': 0,
        'source': sources[i % 5],
        'time_minutes': 75,
        'notes': note,
      }),
  ];
  final List<Map<String, dynamic>> pyqs = <Map<String, dynamic>>[
    for (int i = 0; i < 18; i++)
      _row('q$i', <String, dynamic>{
        'chapter_id': 'c${i % 36}',
        'exam': i.isEven ? 'Main' : 'Advanced',
        'year': 2024 - (i % 10),
        'status': i % 3 == 0 ? 'done' : 'pending',
        'questions_total': 24,
        'questions_done': i % 24,
      }),
  ];
  final List<Map<String, dynamic>> cards = <Map<String, dynamic>>[
    for (int i = 0; i < 16; i++)
      _row('k$i', <String, dynamic>{
        'chapter_id': 'c${i % 36}',
        'kind': i.isEven ? 'formula' : 'flashcard',
        'front': 'Self inductance of a long solenoid with a ferromagnetic core of relative permeability μr',
        'back': 'L = μ0 μr n² A l, where n is turns per unit length; energy stored is ½ L I². $note',
        'hint': 'Think flux linkage per unit current',
        'position': i,
        'difficulty': 'difficult',
        'reviews': i,
      }),
  ];
  const List<String> categories = <String>[
    'Silly mistake',
    'Concept gap',
    'Calculation error',
    'Time pressure',
    'Misread question',
    'Guess / bad attempt',
    'Unattempted',
  ];
  final List<Map<String, dynamic>> errorLogs = <Map<String, dynamic>>[
    for (int i = 0; i < 21; i++)
      _row('e$i', <String, dynamic>{
        'test_id': 't${i % 18}',
        'chapter_id': 'c${i % 36}',
        'subject': subjects[i % 3],
        'category': categories[i % 7],
        'marks_lost': 4 + i % 9,
        'questions': 1 + i % 4,
        'note': note,
      }),
  ];
  return jsonEncode(<String, dynamic>{
    'format': 'stracker-json',
    'version': 2,
    'user_id': _user,
    'settings': <String, dynamic>{
      'user_id': _user,
      'owner_name': 'Aarav Venkataraman Subramaniam-Chaudhary',
      'exam_year': 2027,
      'onboarding_completed': true,
      'theme': 'light',
      'exam_mode': 'auto',
      'active_track': 'main1',
    },
    'profile': _row(_user, <String, dynamic>{'display_name': 'Aarav', 'email': 'aarav.long.address@example.com'}),
    'chapters': chapters,
    'chapter_revisions': revisions,
    'tests': tests,
    'mistakes': mistakes,
    'daily_tasks': tasks,
    'study_sessions': sessions,
    'practice_sessions': practice,
    'pyq_records': pyqs,
    'backlog_items': backlog,
    'study_cards': cards,
    'test_error_logs': errorLogs,
  });
}

Future<void> _setWindow(WidgetTester tester, Size size) async {
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = size * 2;
  tester.view.padding = const FakeViewPadding(top: 48, bottom: 32);
  tester.view.viewPadding = const FakeViewPadding(top: 48, bottom: 32);
}

Future<DataController> _pump(WidgetTester tester, Widget home) async {
  SharedPreferences.setMockInitialValues(<String, Object>{'stracker.cache.$_user': _snapshot()});
  final SharedPreferences prefs = await SharedPreferences.getInstance();
  final DataController data = DataController(
    repository: StrackerRepository(SupabaseClient(
      'http://127.0.0.1:1',
      'x',
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    )),
    preferences: prefs,
    userId: _user,
  );
  final StrackerPalette palette = strackerPalettes['default']!['light']!;
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        preferencesProvider.overrideWithValue(prefs),
        themeControllerProvider.overrideWith((Ref ref) => ThemeController(prefs)),
        dataControllerProvider.overrideWith((Ref ref) => data),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: buildStrackerTheme(palette: palette, brightness: Brightness.light),
        home: home,
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 400));
  return data;
}

Future<void> _loadFonts() async {
  final Map<String, FontLoader> loaders = <String, FontLoader>{};
  for (final FileSystemEntity file in Directory('assets/fonts').listSync()) {
    final String name = file.uri.pathSegments.last;
    if (!name.endsWith('.ttf') && !name.endsWith('.otf')) continue;
    final String family = name.split('-').first.split('.').first;
    loaders.putIfAbsent(family, () => FontLoader(family)).addFont(rootBundle.load('assets/fonts/$name'));
  }
  for (final FontLoader loader in loaders.values) {
    await loader.load();
  }
}

void main() {
  setUpAll(_loadFonts);

  testWidgets('the long notebook snapshot decodes every table', (WidgetTester tester) async {
    final DataController data = await _pump(tester, const SizedBox());
    expect(data.state.data.chapters, hasLength(36));
    expect(data.state.data.tests, hasLength(18));
    expect(data.state.data.mistakes, hasLength(24));
    expect(data.state.data.revisions, hasLength(20));
    expect(data.state.data.backlogItems, hasLength(16));
    expect(data.state.data.errorLogs, hasLength(21));
  });

  final Map<String, Widget> pages = <String, Widget>{
    'Shell': const AppShell(),
    'Splash': const SplashPage(progress: 0.4),
    'Home': const HomePage(),
    'Tests': const TestsPage(),
    'Analytics': const AnalyticsPage(),
    'Profile': const ProfilePage(),
    'Syllabus': const SyllabusPage(),
    'WeakAreas': const WeakAreasPage(),
    'Backup': const BackupPage(),
    'MockAnalysis': const MockAnalysisPage(),
    'StudyNow': const StudyNowPage(),
    'Revision': const RevisionPage(),
    'Backlog': const BacklogPage(),
    'Mistakes': const MistakesPage(),
    'Retry': const RetryPage(),
    'Planner': const PlannerPage(),
    'Settings': const SettingsPage(),
    'Focus': const FocusPage(),
    'Decks': const DecksPage(),
    'Practice': const PracticePage(),
    'Pyq': const PyqPage(),
  };
  for (final MapEntry<String, Widget> page in pages.entries) {
    for (final (String name, Size size) in _sizes) {
      testWidgets('${page.key} with long data at $name: no overflow', (WidgetTester tester) async {
        addTearDown(tester.view.reset);
        await _setWindow(tester, size);
        await _pump(tester, page.value);
        expect(tester.takeException(), isNull);
        // Scroll to the end so lower cards are laid out and checked too.
        final Finder scrollables = find.byType(Scrollable);
        if (scrollables.evaluate().isNotEmpty) {
          await tester.drag(scrollables.first, const Offset(0, -6000), warnIfMissed: false);
          await tester.pump(const Duration(milliseconds: 400));
          expect(tester.takeException(), isNull);
        }
      });
    }
  }

  // Inline editors with the on-screen keyboard up: the page shrinks above it and scrolls
  // instead of overflowing.
  final Map<String, Widget> editors = <String, Widget>{
    'Settings': const SettingsPage(),
    'Profile': const ProfilePage(),
    'MockAnalysis': const MockAnalysisPage(),
    'Backup': const BackupPage(),
    'Shell': const AppShell(),
  };
  for (final MapEntry<String, Widget> page in editors.entries) {
    for (final (String name, Size size) in _sizes.take(4)) {
      testWidgets('${page.key} with the keyboard open at $name: no overflow', (WidgetTester tester) async {
        addTearDown(tester.view.reset);
        await _setWindow(tester, size);
        tester.view.viewInsets = FakeViewPadding(bottom: size.height * 2 * 0.4);
        await _pump(tester, page.value);
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets('editor sheet with the keyboard open on the smallest phone: scrolls, no overflow',
      (WidgetTester tester) async {
    addTearDown(tester.view.reset);
    await _setWindow(tester, const Size(360, 780));
    tester.view.viewInsets = const FakeViewPadding(bottom: 620);
    await _pump(
      tester,
      Scaffold(
        body: Builder(
          builder: (BuildContext context) => TextButton(
            onPressed: () => showAppSheet<void>(
              context,
              title: 'Edit chapter — Electromagnetic Induction and Alternating Current Circuits',
              builder: (BuildContext sheetContext) => Column(
                children: <Widget>[
                  for (int i = 0; i < 14; i += 1) TextField(decoration: InputDecoration(labelText: 'Field $i')),
                ],
              ),
            ),
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pump(const Duration(milliseconds: 600));
    expect(tester.takeException(), isNull);
    expect(find.text('Field 0'), findsOneWidget);
  });
}
