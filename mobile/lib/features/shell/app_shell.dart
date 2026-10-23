import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/theme_controller.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../analytics/analytics_page.dart';
import '../auth/auth_controller.dart';
import '../home/home_page.dart';
import '../profile/profile_page.dart';
import '../tests/tests_page.dart';
import 'routes.dart';

/// The four primary destinations. Each page keeps its own scroll position because the
/// shell holds them in an IndexedStack.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _index = 0;

  static const List<String> _titles = <String>['Home', 'Tests', 'Analytics', 'Profile'];

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return PopScope(
      // Back from a secondary tab returns to Home; back on Home leaves the app, which is
      // the expected Android behaviour. An open drawer is closed first by its own history
      // entry, and a pushed section is popped by the Navigator before this runs.
      canPop: _index == 0,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (didPop) return;
        setState(() => _index = 0);
      },
      child: Scaffold(
        backgroundColor: colors.palette.bg,
        body: IndexedStack(
          index: _index,
          children: const <Widget>[
            HomePage(),
            TestsPage(),
            AnalyticsPage(),
            ProfilePage(),
          ],
        ),
        bottomNavigationBar: _BottomTabs(index: _index, onSelected: (int index) {
          if (_index == index) return;
          setState(() => _index = index);
        }),
      ),
    );
  }

  String get title => _titles[_index];
}

class _BottomTabs extends StatelessWidget {
  const _BottomTabs({required this.index, required this.onSelected});

  final int index;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Container(
      decoration: BoxDecoration(
        color: colors.palette.paper,
        border: Border(top: BorderSide(color: colors.palette.line)),
      ),
      child: SafeArea(
        top: false,
        child: NavigationBar(
          selectedIndex: index,
          onDestinationSelected: onSelected,
          backgroundColor: colors.palette.paper,
          destinations: const <NavigationDestination>[
            NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
            NavigationDestination(icon: Icon(Icons.list_alt_outlined), selectedIcon: Icon(Icons.list_alt), label: 'Tests'),
            NavigationDestination(icon: Icon(Icons.insights_outlined), selectedIcon: Icon(Icons.insights), label: 'Analytics'),
            NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
          ],
        ),
      ),
    );
  }
}

/// Every page's chrome: branded app bar, sync pill, theme switch, drawer, menu and the
/// global search. Pushed pages get a back arrow instead of the brand block.
class NotebookScaffold extends ConsumerWidget {
  const NotebookScaffold({
    super.key,
    required this.title,
    required this.body,
    this.subtitle,
    this.showBack = false,
    this.actions = const <Widget>[],
    this.floatingActionButton,
    this.showBrand = false,
    this.bottom,
  });

  final String title;
  final String? subtitle;
  final Widget body;
  final bool showBack;
  final List<Widget> actions;
  final Widget? floatingActionButton;
  final bool showBrand;
  final Widget? bottom;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final DataState data = ref.watch(dataControllerProvider);
    return Scaffold(
      backgroundColor: colors.palette.bg,
      drawer: const NotebookDrawer(),
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: bottom,
      appBar: AppBar(
        automaticallyImplyLeading: showBack,
        leading: showBack
            ? const BackButton()
            : Builder(
                builder: (BuildContext context) => IconButton(
                  tooltip: 'Open navigation',
                  icon: const Icon(Icons.menu, size: 22),
                  onPressed: () => Scaffold.of(context).openDrawer(),
                ),
              ),
        titleSpacing: 0,
        title: showBrand
            ? Row(
                children: <Widget>[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(9),
                    child: Image.asset('assets/brand/logo.png', width: 30, height: 30),
                  ),
                  const SizedBox(width: 9),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      Text(
                        title,
                        style: TextStyle(
                          fontFamily: 'PatrickHand',
                          fontSize: 22,
                          height: 1,
                          color: colors.palette.ink,
                        ),
                      ),
                      Text(
                        'DYPOL LABS',
                        style: TextStyle(
                          fontFamily: 'Lexend',
                          fontSize: 8.5,
                          letterSpacing: 1.6,
                          color: colors.muted,
                        ),
                      ),
                    ],
                  ),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Text(
                    title,
                    style: TextStyle(
                      fontFamily: 'PatrickHand',
                      fontSize: 22,
                      height: 1,
                      color: colors.palette.ink,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle!,
                      style: TextStyle(fontFamily: 'Lexend', fontSize: 9.5, color: colors.muted),
                    ),
                ],
              ),
        actions: <Widget>[
          ...actions,
          SyncPill(state: data),
          IconButton(
            tooltip: 'Search notebook',
            icon: const Icon(Icons.search, size: 21),
            onPressed: () => showAppSheet<void>(
              context,
              title: 'Search notebook',
              builder: (BuildContext sheetContext) => const GlobalSearchBody(),
            ),
          ),
          ThemeToggleButton(),
        ],
      ),
      body: SafeArea(top: false, child: body),
    );
  }
}

class SyncPill extends ConsumerWidget {
  const SyncPill({super.key, required this.state});

  final DataState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final String label = state.saving
        ? 'Saving'
        : state.offline
            ? 'Offline'
            : 'Synced';
    final Color tone = state.saving
        ? colors.palette.orange
        : state.offline
            ? colors.palette.red
            : colors.palette.green;
    return Tooltip(
      message: state.error ??
          (state.lastSyncedAt == null
              ? 'Not synced yet — tap to refresh'
              : 'Last synced ${formatDateTime(state.lastSyncedAt)} — tap to refresh'),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: () => ref.read(dataControllerProvider.notifier).load(),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          child: state.loading
              ? SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 1.8, color: colors.palette.accent),
                )
              : Icon(Icons.cloud_sync_outlined, size: 19, color: tone, semanticLabel: label),
        ),
      ),
    );
  }
}

class ThemeToggleButton extends ConsumerWidget {
  const ThemeToggleButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ThemeState appearance = ref.watch(themeControllerProvider);
    final Brightness effective = appearance.mode == ThemeMode.system
        ? MediaQuery.platformBrightnessOf(context)
        : (appearance.mode == ThemeMode.dark ? Brightness.dark : Brightness.light);
    final bool dark = effective == Brightness.dark;
    return IconButton(
      tooltip: dark ? 'Switch to light' : 'Switch to night',
      icon: Icon(dark ? Icons.light_mode_outlined : Icons.dark_mode_outlined, size: 20),
      onPressed: () async {
        await ref.read(themeControllerProvider.notifier).toggle(effective);
        final DataController controller = ref.read(dataControllerProvider.notifier);
        final AppData data = ref.read(dataControllerProvider).data;
        final ThemeState next = ref.read(themeControllerProvider);
        try {
          await controller.saveSettings(data.settings.copyWith(theme: next.modeValue));
        } catch (_) {
          // The local switch already applied; the account value is retried on the next save.
        }
      },
    );
  }
}

class NotebookDrawer extends ConsumerWidget {
  const NotebookDrawer({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final AppData data = ref.watch(dataControllerProvider).data;
    final String today = todayIso();
    final int revisions = data.openRevisions().where((Revision r) => r.dueOn.compareTo(today) <= 0).length;
    final int retries = data.pendingRetries.length;
    final int backlog = data.backlogItems
        .where((BacklogItem item) =>
            !item.isDone &&
            item.status == 'active' &&
            (item.dueOn == null || item.dueOn!.compareTo(today) <= 0))
        .length;

    void go(String key) {
      Navigator.of(context).pop();
      Routes.open(context, key);
    }

    Widget header() => Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
          child: Row(
            children: <Widget>[
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.asset('assets/brand/logo.png', width: 42, height: 42),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'Stracker',
                      style: TextStyle(
                        fontFamily: 'PatrickHand',
                        fontSize: 26,
                        height: 1,
                        color: colors.palette.ink,
                      ),
                    ),
                    Text(
                      'DYPOL LABS',
                      style: TextStyle(
                        fontFamily: 'Lexend',
                        fontSize: 9,
                        letterSpacing: 2,
                        color: colors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );

    Widget group(String label) => Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 4),
          child: Text(
            label.toUpperCase(),
            style: TextStyle(
              fontFamily: 'Lexend',
              fontSize: 9.5,
              letterSpacing: 1.6,
              fontWeight: FontWeight.w600,
              color: colors.muted,
            ),
          ),
        );

    Widget item(String label, IconData icon, String key, {String? badge, bool highlight = false}) {
      return ListTile(
        dense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 18),
        leading: Icon(icon, size: 19, color: highlight ? colors.palette.accent : colors.inkSoft),
        title: Text(
          label,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: highlight ? colors.palette.textAccent : null,
              ),
        ),
        trailing: badge == null
            ? null
            : Pill(badge, tone: PillTone.warn, dense: true),
        onTap: () => go(key),
      );
    }

    return Drawer(
      backgroundColor: colors.palette.paper,
      child: SafeArea(
        child: Column(
          children: <Widget>[
            header(),
            Divider(height: 1, color: colors.palette.line),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 12),
                children: <Widget>[
                  group('Today'),
                  item('What should I study now?', Icons.explore_outlined, Routes.studyNow, highlight: true),
                  item('Focus timer', Icons.timer_outlined, Routes.focus),
                  item('Backlog', Icons.layers_outlined, Routes.backlog, badge: backlog == 0 ? null : '$backlog'),
                  item('Practice / DPP', Icons.checklist_rtl_outlined, Routes.practice),
                  group('Study'),
                  item('Syllabus', Icons.menu_book_outlined, Routes.syllabus),
                  item('Weak areas', Icons.warning_amber_outlined, Routes.weakAreas),
                  item('PYQs', Icons.local_library_outlined, Routes.pyqs),
                  group('Tests'),
                  item('Test journal', Icons.fact_check_outlined, Routes.tests),
                  item('Mock analysis', Icons.analytics_outlined, Routes.mockAnalysis),
                  item('Mistake notebook', Icons.book_outlined, Routes.mistakes),
                  item('Retry', Icons.replay, Routes.retry, badge: retries == 0 ? null : '$retries'),
                  item('Analytics', Icons.insights_outlined, Routes.analytics),
                  group('Recall'),
                  item('Revisions', Icons.autorenew, Routes.revision, badge: revisions == 0 ? null : '$revisions'),
                  item('Formulas & flashcards', Icons.style_outlined, Routes.decks),
                  group('Plan'),
                  item('Study plan', Icons.event_note_outlined, Routes.planner),
                  item('Stracker AI', Icons.auto_awesome_outlined, 'ai'),
                  item('Settings', Icons.settings_outlined, Routes.settings),
                  item('Backup & export', Icons.backup_outlined, Routes.backup),
                ],
              ),
            ),
            Divider(height: 1, color: colors.palette.line),
            ListTile(
              dense: true,
              contentPadding: const EdgeInsets.symmetric(horizontal: 18),
              leading: Icon(Icons.logout, size: 19, color: colors.palette.red),
              title: Text(
                'Sign out',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(color: colors.palette.red),
              ),
              onTap: () async {
                Navigator.of(context).pop();
                final bool confirmed = await confirmAction(
                  context,
                  title: 'Sign out?',
                  message: 'The offline copy on this device is cleared. Your data stays in Supabase.',
                  confirmLabel: 'Sign out',
                );
                if (!confirmed) return;
                await ref.read(dataControllerProvider.notifier).clearDeviceCache();
                await ref.read(authControllerProvider.notifier).signOut();
              },
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 4, 18, 12),
              child: Text(
                'v1.0.0 · DYPOL LABS',
                style: TextStyle(fontFamily: 'Lexend', fontSize: 9.5, color: colors.muted),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Cross-notebook search: chapters, tests, mistakes and tasks in one place.
class GlobalSearchBody extends ConsumerStatefulWidget {
  const GlobalSearchBody({super.key});

  @override
  ConsumerState<GlobalSearchBody> createState() => _GlobalSearchBodyState();
}

class _GlobalSearchBodyState extends ConsumerState<GlobalSearchBody> {
  final TextEditingController _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppData data = ref.watch(dataControllerProvider).data;
    final String needle = _query.text.trim().toLowerCase();
    final List<Chapter> chapters = needle.isEmpty
        ? const <Chapter>[]
        : data.chapters
            .where((Chapter chapter) =>
                '${chapter.name} ${chapter.subject}'.toLowerCase().contains(needle))
            .take(8)
            .toList();
    final List<TestRecord> tests = needle.isEmpty
        ? const <TestRecord>[]
        : data.tests
            .where((TestRecord test) =>
                '${test.title} ${test.subject ?? ''}'.toLowerCase().contains(needle))
            .take(6)
            .toList();
    final List<Mistake> mistakes = needle.isEmpty
        ? const <Mistake>[]
        : data.mistakes
            .where((Mistake mistake) =>
                '${mistake.questionNote} ${mistake.solutionNote}'.toLowerCase().contains(needle))
            .take(6)
            .toList();
    final List<DailyTask> tasks = needle.isEmpty
        ? const <DailyTask>[]
        : data.tasks
            .where((DailyTask task) => task.title.toLowerCase().contains(needle))
            .take(6)
            .toList();
    final bool empty = chapters.isEmpty && tests.isEmpty && mistakes.isEmpty && tasks.isEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SearchBox(
          controller: _query,
          hint: 'Chapters, tests, mistakes, tasks',
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        if (needle.isEmpty)
          const InfoBanner(
            'Search across the whole notebook. Results open the section that owns them.',
            icon: Icons.manage_search,
          )
        else if (empty)
          const EmptyState(
            title: 'Nothing found',
            message: 'Try a chapter name, a test title or a phrase from a mistake note.',
            icon: Icons.search_off,
          )
        else ...<Widget>[
          if (chapters.isNotEmpty) ...<Widget>[
            const SectionHeading('Chapters'),
            for (final Chapter chapter in chapters)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(chapter.name),
                subtitle: Text('${chapter.subject} · ${chapter.status}'),
                trailing: const Icon(Icons.chevron_right, size: 18),
                onTap: () {
                  Navigator.of(context).pop();
                  Routes.open(context, Routes.syllabus);
                },
              ),
          ],
          if (tests.isNotEmpty) ...<Widget>[
            const SectionHeading('Tests'),
            for (final TestRecord test in tests)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(test.title),
                subtitle: Text('${test.testType} · ${test.testDate}'),
                trailing: const Icon(Icons.chevron_right, size: 18),
                onTap: () {
                  Navigator.of(context).pop();
                  Routes.open(context, Routes.tests);
                },
              ),
          ],
          if (mistakes.isNotEmpty) ...<Widget>[
            const SectionHeading('Mistakes'),
            for (final Mistake mistake in mistakes)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(
                  mistake.questionNote,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text('${mistake.mistakeType} · ${data.chapterName(mistake.chapterId)}'),
                trailing: const Icon(Icons.chevron_right, size: 18),
                onTap: () {
                  Navigator.of(context).pop();
                  Routes.open(context, Routes.mistakes);
                },
              ),
          ],
          if (tasks.isNotEmpty) ...<Widget>[
            const SectionHeading('Tasks'),
            for (final DailyTask task in tasks)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(task.title),
                subtitle: Text('${task.taskDate} · ${task.priority}'),
                trailing: const Icon(Icons.chevron_right, size: 18),
                onTap: () {
                  Navigator.of(context).pop();
                  Routes.open(context, Routes.planner);
                },
              ),
          ],
        ],
      ],
    );
  }
}

/// Standard page body: scrolling, pull-to-refresh, tablet max width and consistent padding.
class PageBody extends StatelessWidget {
  const PageBody({
    super.key,
    required this.children,
    this.padding = const EdgeInsets.fromLTRB(14, 12, 14, 100),
    this.refresh,
  });

  final List<Widget> children;
  final EdgeInsetsGeometry padding;
  final Future<void> Function()? refresh;

  @override
  Widget build(BuildContext context) {
    final Widget list = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: padding,
      children: <Widget>[
        ContentWidth(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: children,
          ),
        ),
      ],
    );
    if (refresh == null) return list;
    return RefreshIndicator(onRefresh: refresh!, child: list);
  }
}

/// Pushed page wrapper: back arrow, title and the same body conventions.
class SectionPage extends StatelessWidget {
  const SectionPage({
    super.key,
    required this.title,
    required this.child,
    this.subtitle,
    this.actions = const <Widget>[],
    this.floatingActionButton,
  });

  final String title;
  final Widget child;
  final String? subtitle;
  final List<Widget> actions;
  final Widget? floatingActionButton;

  @override
  Widget build(BuildContext context) {
    return NotebookScaffold(
      title: title,
      subtitle: subtitle,
      showBack: true,
      actions: actions,
      floatingActionButton: floatingActionButton,
      body: child,
    );
  }
}

/// Floating quick actions: the four entries a student needs most often.
class QuickActionButton extends ConsumerWidget {
  const QuickActionButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    return FloatingActionButton(
      backgroundColor: colors.palette.accentDark,
      foregroundColor: Colors.white,
      tooltip: 'Quick actions',
      onPressed: () => showAppSheet<void>(
        context,
        title: 'Quick actions',
        builder: (BuildContext sheetContext) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (final (String label, IconData icon, String key) action in <(String, IconData, String)>[
              ('Log a test', Icons.fact_check_outlined, Routes.tests),
              ('Log practice', Icons.checklist_rtl_outlined, Routes.practice),
              ('Add a mistake', Icons.book_outlined, Routes.mistakes),
              ('Plan a task', Icons.event_note_outlined, Routes.planner),
              ('Start focus', Icons.timer_outlined, Routes.focus),
              ('Stracker AI', Icons.auto_awesome_outlined, 'ai'),
            ])
              ListTile(
                leading: Icon(action.$2, size: 20),
                title: Text(action.$1),
                trailing: const Icon(Icons.chevron_right, size: 18),
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  Routes.open(context, action.$3);
                },
              ),
          ],
        ),
      ),
      child: const Icon(Icons.add, size: 26),
    );
  }
}

/// Formats a badge count, keeping the drawer readable for large numbers.
String badgeLabel(int value) => value > 99 ? '99+' : '$value';

/// Shared helper so pages can show the "add" affordance consistently.
Widget addButton(String label, VoidCallback onPressed) => TextButton.icon(
      onPressed: onPressed,
      icon: const Icon(Icons.add, size: 17),
      label: Text(label),
    );

/// Used by pages that need the current exam label in a heading.
String examBadge(AppData data) => numberLabel(data.settings.targetScore, digits: 0);
