import 'dart:async';
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/date.dart';
import '../../core/format.dart';
import '../../core/layout.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/notebook.dart';
import '../../core/widgets/wandering_eyes.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../analytics/analytics_page.dart';
import '../home/home_page.dart';
import '../planner/planner_page.dart';
import '../practice/practice_page.dart';
import '../profile/profile_page.dart';
import '../search/notebook_search.dart';
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
  bool _quickOpen = false;

  /// Keeps the four tab pages (and their scroll positions and form state) alive when the
  /// layout switches between the bottom bar and the sidebar on rotation or resize.
  final GlobalKey _pagesKey = GlobalKey(debugLabel: 'shell-pages');

  /// Sections open in this navigator, inside the content area, so the bottom bar or the
  /// sidebar stays visible like on the website.
  final GlobalKey<NavigatorState> _contentKey = GlobalKey<NavigatorState>(debugLabel: 'shell-content');
  late final _SectionObserver _observer = _SectionObserver(_onSectionsChanged);

  /// Whether a section page is open over the tabs (it then hosts its own floating buttons).
  bool _sectionOpen = false;

  void _onSectionsChanged() {
    final bool open = _contentKey.currentState?.canPop() ?? false;
    if (open != _sectionOpen && mounted) setState(() => _sectionOpen = open);
  }

  @override
  void initState() {
    super.initState();
    Routes.contentNavigator = _contentKey;
  }

  @override
  void dispose() {
    if (Routes.contentNavigator == _contentKey) Routes.contentNavigator = null;
    super.dispose();
  }

  /// The website's Ask Stracker launcher grows into a labelled pill while the student
  /// scrolls down and folds back to a circle on scroll up or at the top.
  bool _aiExpanded = false;

  bool _onScroll(UserScrollNotification note) {
    final bool? next = aiLauncherExpanded(note, _aiExpanded);
    if (next != null && next != _aiExpanded) setState(() => _aiExpanded = next);
    return false;
  }

  static const List<String> _labels = <String>['Home', 'Tests', 'Analytics', 'Profile'];
  static const List<IconData> _icons = <IconData>[
    Icons.home_outlined,
    Icons.checklist,
    Icons.monitor_heart_outlined,
    Icons.person_outline,
  ];
  static const List<IconData> _selectedIcons = <IconData>[
    Icons.home,
    Icons.checklist,
    Icons.monitor_heart,
    Icons.person,
  ];

  void _select(int index) {
    if (_quickOpen) setState(() => _quickOpen = false);
    // A tab tap always lands on that tab, closing any open section (the website's bar is a
    // set of links, not a history).
    final NavigatorState? sections = _contentKey.currentState;
    if (sections != null && sections.canPop()) {
      sections.popUntil((Route<dynamic> route) => route.isFirst);
      HapticFeedback.selectionClick();
    }
    if (_index == index) return;
    // A short, light tap: the same feedback Android gives its own tab bars.
    HapticFeedback.selectionClick();
    setState(() => _index = index);
  }

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    // Landscape tablets get the website's desktop sidebar; phones and portrait tablets keep
    // the floating thumb-reach bar. Re-evaluated on every rotation / resize.
    final bool wide = AppLayout.useSidebar(MediaQuery.sizeOf(context));

    const List<Widget> pages = <Widget>[
      HomePage(),
      TestsPage(),
      AnalyticsPage(),
      ProfilePage(),
    ];

    final Widget tabs = NotificationListener<UserScrollNotification>(
      onNotification: _onScroll,
      child: FloatingClearance(
        // Bottom room so the last card scrolls clear of the two floating buttons.
        bottom: 140,
        child: _FadeIndexedStack(index: _index, children: pages),
      ),
    );

    // Sections (Syllabus, Backlog, Settings...) are pushed onto this navigator, so they
    // render in the content area beside the sidebar or above the bottom bar. Android's
    // back pops them first (NavigatorPopHandler), then the tab logic below runs.
    final Widget content = KeyedSubtree(
      key: _pagesKey,
      child: SidebarScope(
        visible: wide,
        child: NavigatorPopHandler(
          onPopWithResult: (Object? result) => _contentKey.currentState?.maybePop(),
          child: HeroMode(
            // Every section has its own add button; heroes between nested pages would
            // only collide on the shared default tag.
            enabled: false,
            child: _ShellTabsScope(
              tabs: tabs,
              child: Navigator(
                key: _contentKey,
                observers: <NavigatorObserver>[_observer],
                onGenerateInitialRoutes: (NavigatorState navigator, String initial) => <Route<dynamic>>[
                  PageRouteBuilder<void>(
                    settings: const RouteSettings(name: '/'),
                    pageBuilder: (BuildContext context, Animation<double> a, Animation<double> b) => _ShellTabs(
                      builder: () => tabs,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    return PopScope(
      // Back from a secondary tab returns to Home; back on Home leaves the app, which is
      // the expected Android behaviour. An open drawer is closed first by its own history
      // entry, and a pushed section is popped by the Navigator before this runs.
      canPop: _index == 0 && !_quickOpen && !_sectionOpen,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (didPop) return;
        // An open section is popped by the content navigator's own handler.
        if (_contentKey.currentState?.canPop() ?? false) return;
        if (_quickOpen) {
          setState(() => _quickOpen = false);
          return;
        }
        setState(() => _index = 0);
      },
      child: Scaffold(
        backgroundColor: colors.palette.bg,
        // Pages scroll behind the floating bottom bar; its own fade and blur keep the bar
        // readable, so there is no solid strip under it.
        extendBody: !wide,
        body: wide
            ? Row(
                // Stretch gives the pages a bounded height, which the crossfade needs.
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  NotebookDrawer(
                    key: const ValueKey<String>('sidebar'),
                    permanent: true,
                    tabIndex: _index,
                    onTab: _select,
                  ),
                  VerticalDivider(width: 1, color: colors.palette.line),
                  Expanded(child: content),
                ],
              )
            : content,
        // A section hosts its own copy of the buttons (above its add button).
        floatingActionButton: _sectionOpen
            ? null
            : _FloatingActions(
                open: _quickOpen,
                aiExpanded: _aiExpanded,
                onToggle: () {
                  HapticFeedback.lightImpact();
                  setState(() => _quickOpen = !_quickOpen);
                },
                onClose: () => setState(() => _quickOpen = false),
              ),
        bottomNavigationBar:
            wide ? null : _BottomTabs(key: const ValueKey<String>('bottom-tabs'), index: _index, onSelected: _select),
      ),
    );
  }
}

/// The first page of the content navigator. It rebuilds from the shell's latest widget
/// tree through [_ShellTabsScope], because a route's page builder is only called once.
class _ShellTabs extends StatelessWidget {
  const _ShellTabs({required this.builder});

  final Widget Function() builder;

  @override
  Widget build(BuildContext context) {
    final _ShellTabsScope? scope = context.dependOnInheritedWidgetOfExactType<_ShellTabsScope>();
    return scope?.tabs ?? builder();
  }
}

class _ShellTabsScope extends InheritedWidget {
  const _ShellTabsScope({required this.tabs, required super.child});

  final Widget tabs;

  @override
  bool updateShouldNotify(_ShellTabsScope oldWidget) => !identical(oldWidget.tabs, tabs);
}

/// Tells the shell when sections are pushed or popped in the content area.
class _SectionObserver extends NavigatorObserver {
  _SectionObserver(this.onChange);

  final VoidCallback onChange;

  void _later() => WidgetsBinding.instance.addPostFrameCallback((_) => onChange());

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) => _later();

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) => _later();

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) => _later();

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) => _later();
}

/// Crossfades between the four tabs over 180 ms while keeping each page's state and scroll
/// position alive. Cheaper than rebuilding on every switch, and it gives the change a bit
/// of motion instead of a hard cut.
class _FadeIndexedStack extends StatelessWidget {
  const _FadeIndexedStack({required this.index, required this.children});

  final int index;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        for (int i = 0; i < children.length; i += 1)
          Positioned.fill(
            child: IgnorePointer(
              ignoring: i != index,
              child: ExcludeSemantics(
                excluding: i != index,
                child: AnimatedOpacity(
                  opacity: i == index ? 1 : 0,
                  duration: const Duration(milliseconds: 180),
                  curve: Curves.easeOut,
                  child: TickerMode(enabled: i == index, child: children[i]),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// The website's phone bar (responsive.css `.mobile-nav` under 700 px): a rounded paper
/// card floating 10 px off the edges, four equal items, the active one tinted.
class _BottomTabs extends StatelessWidget {
  const _BottomTabs({super.key, required this.index, required this.onSelected});

  final int index;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return ChromeFade(
      fromTop: false,
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.only(bottom: 10),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, ChromeFade.fade, 10, 0),
          child: FrostedBar(
            radius: 22,
            child: Padding(
              padding: const EdgeInsets.all(6),
              child: Row(
                children: <Widget>[
                  for (int i = 0; i < _AppShellState._labels.length; i += 1)
                    Expanded(
                      child: _BottomTabItem(
                        label: _AppShellState._labels[i],
                        icon: i == index ? _AppShellState._selectedIcons[i] : _AppShellState._icons[i],
                        selected: i == index,
                        onTap: () => onSelected(i),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The soft wash behind a floating bar: the page colour, nearly opaque at the screen edge
/// and fading to clear towards the content, so lists scroll under the bar instead of
/// stopping at a solid strip (the system bars are transparent, see app.dart). Paint only:
/// no blur here, the one blur per bar is inside [FrostedBar].
class ChromeFade extends StatelessWidget {
  const ChromeFade({super.key, required this.fromTop, required this.child});

  /// Height of the fade beyond the bar.
  static const double fade = 14;

  final bool fromTop;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final Color bg = context.stracker.palette.bg;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: fromTop ? Alignment.topCenter : Alignment.bottomCenter,
          end: fromTop ? Alignment.bottomCenter : Alignment.topCenter,
          colors: <Color>[bg.withValues(alpha: 0.94), bg.withValues(alpha: 0.72), bg.withValues(alpha: 0)],
          stops: const <double>[0, 0.55, 1],
        ),
      ),
      child: child,
    );
  }
}

/// The website's rounded floating bar surface, translucent with one light background blur
/// so the content passing under it stays readable. Tinted from the palette in both themes
/// (no fixed black or white).
class FrostedBar extends StatelessWidget {
  const FrostedBar({super.key, required this.radius, required this.child});

  final double radius;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final bool dark = Theme.of(context).brightness == Brightness.dark;
    final BorderRadius shape = BorderRadius.circular(radius);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: shape,
        // A soft, palette-tinted --shadow-float; light enough not to read as a black slab.
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: colors.palette.ink.withValues(alpha: dark ? 0.18 : 0.10),
            blurRadius: 24,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: shape,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
          child: Material(
            color: colors.palette.paper.withValues(alpha: dark ? 0.80 : 0.84),
            shape: RoundedRectangleBorder(
              borderRadius: shape,
              side: BorderSide(color: colors.palette.lineStrong.withValues(alpha: 0.7)),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

/// How far the floating header reaches down the page (status bar, bar and its fade). Pages
/// start their content below it and scroll underneath. Zero outside a [NotebookScaffold].
class ChromeInsets extends InheritedWidget {
  const ChromeInsets({super.key, required this.top, required super.child});

  final double top;

  static double topOf(BuildContext context) => context.dependOnInheritedWidgetOfExactType<ChromeInsets>()?.top ?? 0;

  @override
  bool updateShouldNotify(ChromeInsets oldWidget) => oldWidget.top != top;
}

class _BottomTabItem extends StatelessWidget {
  const _BottomTabItem({required this.label, required this.icon, required this.selected, required this.onTap});

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final Color fg = selected ? colors.palette.accent : colors.muted;
    return Semantics(
      selected: selected,
      button: true,
      label: label,
      excludeSemantics: true,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        decoration: BoxDecoration(
          // A quiet accent wash for the active tab, as on the website, in both themes.
          color: selected ? colors.palette.accent.withValues(alpha: 0.16) : Colors.transparent,
          borderRadius: BorderRadius.circular(16),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 54),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(icon, size: 22, color: fg),
                const SizedBox(height: 3),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12.5,
                    color: fg,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The website's launcher rule: a labelled pill while scrolling down, a circle on scroll up
/// or near the top. Null for horizontal scrolling, which leaves it as it is.
bool? aiLauncherExpanded(UserScrollNotification note, bool current) {
  if (note.metrics.axis != Axis.vertical) return null;
  if (note.metrics.pixels <= 24) return false;
  if (note.direction == ScrollDirection.reverse) return true;
  if (note.direction == ScrollDirection.forward) return false;
  return current;
}

/// Tells the tab pages that the permanent sidebar is showing, so their headers drop the
/// menu button (the sidebar already lists every section).
class SidebarScope extends InheritedWidget {
  const SidebarScope({super.key, required this.visible, required super.child});

  final bool visible;

  static bool of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<SidebarScope>()?.visible ?? false;

  @override
  bool updateShouldNotify(SidebarScope oldWidget) => oldWidget.visible != visible;
}

/// Extra bottom padding [PageBody] keeps so floating buttons never cover the last card.
class FloatingClearance extends InheritedWidget {
  const FloatingClearance({super.key, required this.bottom, required super.child});

  final double bottom;

  static double? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<FloatingClearance>()?.bottom;

  @override
  bool updateShouldNotify(FloatingClearance oldWidget) => oldWidget.bottom != bottom;
}

/// The website's two floating buttons, stacked at the bottom right: "Ask Stracker" (a
/// paper circle that grows into a labelled pill while scrolling down) above the
/// quick-action lightning button, whose menu opens upward with the same four actions.
class _FloatingActions extends ConsumerWidget {
  const _FloatingActions({
    required this.open,
    required this.aiExpanded,
    required this.onToggle,
    required this.onClose,
  });

  final bool open;
  final bool aiExpanded;
  final VoidCallback onToggle;
  final VoidCallback onClose;

  static const double _size = 48;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final bool reduceMotion = MediaQuery.disableAnimationsOf(context);
    final Duration motion = reduceMotion ? Duration.zero : const Duration(milliseconds: 200);

    Future<void> run(Future<void> Function() action) async {
      onClose();
      await HapticFeedback.selectionClick();
      await action();
    }

    Widget menuItem(IconData icon, String label, Future<void> Function() action, {IconData? trailing}) {
      return InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => run(action),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
            child: Row(
              children: <Widget>[
                Icon(icon, size: 18, color: colors.inkSoft),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(label, style: TextStyle(fontSize: 14, color: colors.palette.inkSoft)),
                ),
                if (trailing != null) Icon(trailing, size: 15, color: colors.muted),
              ],
            ),
          ),
        ),
      );
    }

    final Widget menu = Container(
      width: 204,
      padding: const EdgeInsets.all(7),
      decoration: BoxDecoration(
        color: colors.palette.paper,
        border: Border.all(color: colors.palette.lineStrong),
        borderRadius: BorderRadius.circular(14),
        boxShadow: const <BoxShadow>[
          BoxShadow(color: Color(0x2929332D), blurRadius: 42, offset: Offset(0, 18)),
          BoxShadow(color: Color(0x1429332D), blurRadius: 10, offset: Offset(0, 3)),
        ],
      ),
      child: Material(
        type: MaterialType.transparency,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            menuItem(Icons.checklist, 'Plan a task', () => openQuickTask(context, ref)),
            menuItem(Icons.edit_note, 'Add a test', () async {
              final AppData data = ref.read(dataControllerProvider).data;
              await openTestEditor(context, ref, data, null);
            }),
            menuItem(Icons.assignment_outlined, 'Log practice', () async {
              final AppData data = ref.read(dataControllerProvider).data;
              await openPracticeEditor(context, ref, data, null);
            }),
            menuItem(Icons.center_focus_strong_outlined, 'Focus session', () => Routes.open(context, Routes.focus),
                trailing: Icons.timer_outlined),
          ],
        ),
      ),
    );

    final Widget ai = Semantics(
      button: true,
      label: 'Ask Stracker',
      excludeSemantics: true,
      child: Material(
        color: colors.palette.paper,
        shape: StadiumBorder(side: BorderSide(color: colors.palette.lineStrong)),
        elevation: 4,
        shadowColor: const Color(0x662D3C54),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: () async {
            onClose();
            await HapticFeedback.selectionClick();
            if (context.mounted) await Routes.open(context, 'ai');
          },
          child: AnimatedContainer(
            duration: motion,
            curve: Curves.easeOut,
            height: _size,
            constraints: const BoxConstraints(minWidth: _size),
            padding: EdgeInsets.only(left: aiExpanded ? 16 : 14, right: 14),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                AnimatedSize(
                  duration: motion,
                  curve: Curves.easeOut,
                  child: aiExpanded
                      ? Padding(
                          padding: const EdgeInsets.only(right: 7),
                          child: Text(
                            'Ask Stracker',
                            style: TextStyle(
                              fontFamily: 'PatrickHand',
                              fontSize: 15,
                              color: colors.palette.accentDark,
                            ),
                          ),
                        )
                      : const SizedBox.shrink(),
                ),
                Icon(Icons.auto_awesome_outlined, size: 20, color: colors.palette.accent),
              ],
            ),
          ),
        ),
      ),
    );

    final Widget quick = Semantics(
      button: true,
      label: open ? 'Close quick actions' : 'Open quick actions',
      expanded: open,
      excludeSemantics: true,
      child: AnimatedRotation(
        // The website tilts the closed button 2° like a sticky note and squares it when open.
        turns: open ? 0 : 2 / 360,
        duration: motion,
        child: Material(
          color: colors.palette.accent,
          elevation: 6,
          shadowColor: const Color(0x8C324A74),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(15),
            side: BorderSide(color: colors.palette.accentDark),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(15),
            onTap: onToggle,
            child: SizedBox.square(
              dimension: _size,
              child: AnimatedSwitcher(
                duration: motion,
                transitionBuilder: (Widget child, Animation<double> animation) =>
                    ScaleTransition(scale: animation, child: child),
                child: Icon(
                  open ? Icons.close : Icons.bolt,
                  key: ValueKey<bool>(open),
                  size: open ? 23 : 22,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        ),
      ),
    );

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: <Widget>[
        AnimatedSwitcher(
          duration: motion,
          switchInCurve: Curves.easeOut,
          transitionBuilder: (Widget child, Animation<double> animation) => FadeTransition(
            opacity: animation,
            child: ScaleTransition(alignment: Alignment.bottomRight, scale: animation, child: child),
          ),
          // The menu takes the launcher's place while open, like the website where it sits
          // over the Ask Stracker button.
          child: open
              ? KeyedSubtree(key: const ValueKey<String>('menu'), child: menu)
              : KeyedSubtree(key: const ValueKey<String>('ai'), child: ai),
        ),
        const SizedBox(height: 12),
        quick,
      ],
    );
  }
}

/// Every page's chrome: branded app bar, sync pill, theme switch, drawer, menu and the
/// global search. Pushed pages get a back arrow instead of the brand block.
class NotebookScaffold extends ConsumerStatefulWidget {
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
    this.floatingActions = true,
    this.showMenu = true,
    this.scrollBehindHeader = true,
  });

  final String title;
  final String? subtitle;
  final Widget body;
  final bool showBack;
  final List<Widget> actions;
  final Widget? floatingActionButton;
  final bool showBrand;
  final Widget? bottom;

  /// Whether a pushed page shows the website's global Ask Stracker and quick-action
  /// buttons. Off only where they would be redundant (the AI chat itself).
  final bool floatingActions;

  /// The website shows its two-line menu button on every page except Profile.
  final bool showMenu;

  /// Whether [body] starts under the floating header and scrolls behind it. [PageBody]
  /// reads [ChromeInsets] for its first-card offset; a body that does not (the AI chat
  /// with its pinned composer) sets this to false and is placed below the header instead.
  final bool scrollBehindHeader;

  @override
  ConsumerState<NotebookScaffold> createState() => _NotebookScaffoldState();
}

class _NotebookScaffoldState extends ConsumerState<NotebookScaffold> {
  bool _quickOpen = false;
  bool _aiExpanded = false;

  bool _onScroll(UserScrollNotification note) {
    final bool? next = aiLauncherExpanded(note, _aiExpanded);
    if (next != null && next != _aiExpanded) setState(() => _aiExpanded = next);
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final String title = widget.title;
    final String? subtitle = widget.subtitle;
    final bool showBack = widget.showBack;
    final bool showBrand = widget.showBrand;
    final List<Widget> actions = widget.actions;
    final StrackerColors colors = context.stracker;
    final DataState data = ref.watch(dataControllerProvider);
    // Tabs get the buttons from the shell (which provides the clearance); every page pushed
    // over it hosts its own copy, like the website where they float over every route.
    final bool host = widget.floatingActions && context.getInheritedWidgetOfExactType<FloatingClearance>() == null;
    final Widget? pageFab = widget.floatingActionButton;
    Widget body = widget.body;
    Widget? floatingActionButton = pageFab;
    if (host) {
      body = NotificationListener<UserScrollNotification>(
        onNotification: _onScroll,
        child: FloatingClearance(
          // The page's own add button sits under the two global buttons, so pages that
          // have one keep extra room at the end of the list.
          bottom: pageFab == null ? 140 : 206,
          child: body,
        ),
      );
      floatingActionButton = Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: <Widget>[
          _FloatingActions(
            open: _quickOpen,
            aiExpanded: _aiExpanded,
            onToggle: () {
              HapticFeedback.lightImpact();
              setState(() => _quickOpen = !_quickOpen);
            },
            onClose: () {
              if (_quickOpen) setState(() => _quickOpen = false);
            },
          ),
          if (pageFab != null) ...<Widget>[const SizedBox(height: 12), pageFab],
        ],
      );
    }
    final Widget? bottom = widget.bottom;
    final double topInset = MediaQuery.viewPaddingOf(context).top;
    final double barHeight = _NotebookHeader.barHeight(context);
    // Status bar + the bar's 8 px top margin + the bar + the fade under it.
    final double headerExtent = topInset + 8 + barHeight + ChromeFade.fade;
    final Widget header = _NotebookHeader(
      title: title,
      subtitle: subtitle,
      showBack: showBack,
      showBrand: showBrand,
      height: barHeight,
      showMenu: widget.showMenu && !SidebarScope.of(context),
      actions: <Widget>[
        ...actions,
        SyncPill(state: data),
        HeaderIcon(
          label: 'Search notebook',
          icon: Icons.search,
          onTap: () => showNotebookSearch(context),
        ),
      ],
    );
    final Widget scaffold = Scaffold(
      backgroundColor: colors.palette.bg,
      drawer: const NotebookDrawer(),
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: bottom,
      extendBody: bottom == null,
      // The header is drawn by the app rather than by Material's AppBar: the Material
      // version paints its own elevation tint and hover/splash overlay across the title
      // area. This one is the website's floating rounded top bar (brand or title, sync,
      // search, menu) over a soft fade, with the page scrolling underneath it.
      body: Stack(
        children: <Widget>[
          Positioned.fill(
            top: widget.scrollBehindHeader ? 0 : headerExtent - ChromeFade.fade,
            child: SafeArea(
              top: false,
              bottom: false,
              child: ChromeInsets(top: widget.scrollBehindHeader ? headerExtent : 0, child: body),
            ),
          ),
          Positioned(top: 0, left: 0, right: 0, child: header),
        ],
      ),
    );
    if (!host) return scaffold;
    return PopScope(
      // Back closes an open quick-action menu before it leaves the page.
      canPop: !_quickOpen,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (!didPop && _quickOpen) setState(() => _quickOpen = false);
      },
      child: scaffold,
    );
  }
}

/// Shown if the brand image cannot be decoded (a damaged install, or an asset missing from
/// a build). It keeps the header's exact size instead of leaving an empty or grey box.
ImageErrorWidgetBuilder _logoError(double size) {
  return (BuildContext context, Object error, StackTrace? stack) {
    final StrackerColors colors = context.stracker;
    return SizedBox(
      width: size,
      height: size,
      child: ColoredBox(
        color: colors.palette.accentLight,
        child: Center(
          child: Text(
            'S',
            style: TextStyle(
              fontFamily: 'PatrickHand',
              fontSize: size * 0.62,
              color: colors.palette.textAccent,
            ),
          ),
        ),
      ),
    );
  };
}

/// The app's own header: one opaque notebook-coloured surface, a back arrow or the menu,
/// the title block and the page actions. Nothing here is a Material [AppBar], so no
/// elevation tint, hover overlay or splash can be painted over the top strip.
class _NotebookHeader extends StatelessWidget {
  const _NotebookHeader({
    required this.title,
    required this.subtitle,
    required this.showBack,
    required this.showBrand,
    required this.actions,
    required this.height,
    this.showMenu = true,
  });

  final String title;
  final String? subtitle;
  final bool showBack;
  final bool showMenu;
  final bool showBrand;
  final List<Widget> actions;
  final double height;

  /// The bar's height: 52 dp, growing with large system font sizes so the two-line title
  /// block always fits. Computed (not measured) so the page can offset its first card by
  /// the same amount in the same frame.
  static double barHeight(BuildContext context) {
    final double text = MediaQuery.textScalerOf(context).scale(40);
    return text + 10 > 52 ? text + 10 : 52;
  }

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final double topInset = MediaQuery.viewPaddingOf(context).top;
    return ChromeFade(
      fromTop: true,
      child: Padding(
        padding: EdgeInsets.fromLTRB(10, topInset + 8, 10, ChromeFade.fade),
        child: FrostedBar(
          radius: 18,
          child: SizedBox(
            height: height,
            child: Row(
              children: <Widget>[
                if (showBack)
                  HeaderIcon(
                    label: 'Back',
                    icon: Icons.arrow_back,
                    size: 22,
                    onTap: () => Navigator.of(context).maybePop(),
                  )
                else
                  const SizedBox(width: 12),
                Expanded(child: showBrand ? _brand(colors) : _titleBlock(colors)),
                ...actions,
                if (showMenu)
                  Builder(
                    builder: (BuildContext context) => HeaderIcon(
                      label: 'Open navigation',
                      icon: Icons.menu,
                      glyph: const MenuLines(),
                      onTap: () => Scaffold.of(context).openDrawer(),
                    ),
                  ),
                const SizedBox(width: 2),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _brand(StrackerColors colors) => Row(
        children: <Widget>[
          ClipRRect(
            borderRadius: BorderRadius.circular(9),
            child: Image.asset('assets/brand/logo.png', width: 28, height: 28, errorBuilder: _logoError(28)),
          ),
          const SizedBox(width: 9),
          // With the exam chip beside it the brand is the website's compact one: no eyebrow.
          Flexible(child: _titleBlock(colors, eyebrow: 'DYPOL LABS')),
        ],
      );

  Widget _titleBlock(StrackerColors colors, {String? eyebrow}) {
    final String? second = eyebrow ?? subtitle;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontFamily: 'PatrickHand',
            fontSize: 22,
            height: 1.15,
            color: colors.palette.ink,
          ),
        ),
        if (second != null)
          Text(
            second,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontFamily: 'Lexend',
              fontSize: eyebrow == null ? 9.5 : 8.5,
              letterSpacing: eyebrow == null ? 0.2 : 1.6,
              color: colors.muted,
            ),
          ),
      ],
    );
  }
}

/// A header button: a 40 x 44 dp tap target, a native ripple clipped to a circle (never a
/// rectangle across the bar) and a light haptic tick.
class HeaderIcon extends StatelessWidget {
  const HeaderIcon({
    super.key,
    required this.label,
    required this.icon,
    required this.onTap,
    this.size = 20,
    this.glyph,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final double size;

  /// Drawn instead of [icon] when set (the website's two-line menu mark).
  final Widget? glyph;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Semantics(
      label: label,
      button: true,
      child: InkWell(
        onTap: () {
          HapticFeedback.selectionClick();
          onTap();
        },
        customBorder: const CircleBorder(),
        hoverColor: Colors.transparent,
        focusColor: Colors.transparent,
        child: SizedBox(
          width: 40,
          height: 44,
          child: Center(child: glyph ?? Icon(icon, size: size, color: colors.palette.ink)),
        ),
      ),
    );
  }
}

/// The website's mobile menu mark: two 20 x 2 rounded lines, 6 apart (`.mobile-menu-lines`),
/// rather than Material's three-line icon.
class MenuLines extends StatelessWidget {
  const MenuLines({super.key});

  @override
  Widget build(BuildContext context) {
    final Color ink = context.stracker.palette.ink;
    Widget line() => Container(
          width: 20,
          height: 2,
          decoration: BoxDecoration(color: ink, borderRadius: BorderRadius.circular(2)),
        );
    return Column(
      key: const ValueKey<String>('menu-lines'),
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[line(), const SizedBox(height: 6), line()],
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
    return Semantics(
      label: state.error ??
          (state.lastSyncedAt == null
              ? '$label — not synced yet, tap to refresh'
              : '$label — last synced ${formatDateTime(state.lastSyncedAt)}, tap to refresh'),
      button: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: () => ref.read(dataControllerProvider.notifier).load(),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          child: state.loading
              ? WanderingEyes(height: 10, color: colors.palette.accent)
              : Icon(Icons.cloud_sync_outlined, size: 19, color: tone, semanticLabel: label),
        ),
      ),
    );
  }
}

class NotebookDrawer extends ConsumerWidget {
  const NotebookDrawer({super.key, this.permanent = false, this.tabIndex, this.onTab});

  /// Landscape tablets: the same list shown as the website's always-visible desktop
  /// sidebar, with the four main tabs on top instead of a bottom bar.
  final bool permanent;
  final int? tabIndex;
  final ValueChanged<int>? onTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final StrackerColors colors = context.stracker;
    final AppData data = ref.watch(dataControllerProvider).data;
    final String today = todayIso();
    final int revisions = data.openRevisions().where((Revision r) => r.dueOn.compareTo(today) <= 0).length;
    final int retries = data.pendingRetries.length;
    final int backlog = data.backlogItems
        .where((BacklogItem item) =>
            !item.isDone && item.status == 'active' && (item.dueOn == null || item.dueOn!.compareTo(today) <= 0))
        .length;

    void go(String key) {
      HapticFeedback.selectionClick();
      if (!permanent) Navigator.of(context).pop();
      Routes.open(context, key, fromMenu: true);
    }

    Widget header() => Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
          child: Row(
            children: <Widget>[
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.asset('assets/brand/logo.png', width: 42, height: 42, errorBuilder: _logoError(42)),
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

    Widget searchRow() => ListTile(
          dense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 18),
          leading: Icon(Icons.search, size: 19, color: colors.inkSoft),
          title: Text('Search notebook', style: Theme.of(context).textTheme.titleSmall),
          onTap: () {
            final NavigatorState navigator = Navigator.of(context);
            unawaited(showNotebookSearch(context));
            if (!permanent) navigator.pop();
          },
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
        trailing: badge == null ? null : Pill(badge, tone: PillTone.warn, dense: true),
        onTap: () => go(key),
      );
    }

    final Widget body = SafeArea(
      right: !permanent,
      child: Column(
        children: <Widget>[
          header(),
          Divider(height: 1, color: colors.palette.line),
          searchRow(),
          Expanded(
            // The list paints its selection and ink on its own clipped Material, so a
            // highlighted row scrolled under the header never draws over the logo or the
            // fixed search row (the header stays on the opaque sidebar surface).
            child: Material(
              type: MaterialType.transparency,
              clipBehavior: Clip.hardEdge,
              child: ListView(
              padding: const EdgeInsets.only(bottom: 12),
              children: <Widget>[
                if (permanent && onTab != null) ...<Widget>[
                  group('Overview'),
                  for (final (int i, String label, IconData icon) in const <(int, String, IconData)>[
                    (0, 'Home', Icons.home_outlined),
                    (1, 'Tests', Icons.checklist),
                    (2, 'Analytics', Icons.monitor_heart_outlined),
                    (3, 'Profile', Icons.person_outline),
                  ])
                    ListTile(
                      dense: true,
                      selected: tabIndex == i,
                      selectedTileColor: colors.palette.accentLight,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 18),
                      leading: Icon(icon, size: 19, color: tabIndex == i ? colors.palette.accent : colors.inkSoft),
                      title: Text(
                        label,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: tabIndex == i ? colors.palette.textAccent : null,
                            ),
                      ),
                      onTap: () => onTab!(i),
                    ),
                ],
                // The website's phone drawer: its sidebar groups minus the bottom-bar
                // destinations (Home, Tests, Analytics) and Settings, which live on the bar
                // and in Profile. Stracker AI is the floating button above quick actions.
                group('Study'),
                item('Focus', Icons.timer_outlined, Routes.focus),
                item('Backlog', Icons.layers_outlined, Routes.backlog, badge: backlog == 0 ? null : '$backlog'),
                item('Practice', Icons.checklist_rtl_outlined, Routes.practice),
                group('Syllabus'),
                item('Syllabus', Icons.menu_book_outlined, Routes.syllabus),
                item('Weak areas', Icons.warning_amber_outlined, Routes.weakAreas),
                item('PYQs', Icons.local_library_outlined, Routes.pyqs),
                group('Tests'),
                item('Mock analysis', Icons.analytics_outlined, Routes.mockAnalysis),
                item('Mistake notebook', Icons.book_outlined, Routes.mistakes),
                item('Retry', Icons.replay, Routes.retry, badge: retries == 0 ? null : '$retries'),
                group('Revision'),
                item('Revisions', Icons.autorenew, Routes.revision, badge: revisions == 0 ? null : '$revisions'),
                item('Formulas & flashcards', Icons.style_outlined, Routes.decks),
                group('Planning'),
                item('Study now', Icons.explore_outlined, Routes.studyNow, highlight: true),
                item('Study plan', Icons.event_note_outlined, Routes.planner),
                // The desktop sidebar lists Settings under Planning; the phone drawer leaves
                // it to Profile.
                if (permanent) item('Settings', Icons.settings_outlined, Routes.settings),
              ],
            ),
            ),
          ),
          // Sign out lives in Settings only (with a confirm step), not in the menu.
          Divider(height: 1, color: colors.palette.line),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 4, 18, 12),
            child: Text(
              'v1.0.0 · DYPOL LABS',
              style: TextStyle(fontFamily: 'Lexend', fontSize: 9.5, color: colors.muted),
            ),
          ),
        ],
      ),
    );
    if (permanent) {
      return Material(
        color: colors.palette.paper,
        child: SizedBox(width: AppLayout.sidebarWidth, child: body),
      );
    }
    return Drawer(
      backgroundColor: colors.palette.paper,
      width: MediaQuery.sizeOf(context).width < 400 ? 292 : 320,
      child: body,
    );
  }
}

/// Standard page body: scrolling, pull-to-refresh, tablet max width and consistent padding.
class PageBody extends StatelessWidget {
  const PageBody({
    super.key,
    required this.children,
    this.padding,
    this.refresh,
  });

  final List<Widget> children;

  /// Overrides the default padding. Left null it is worked out from the window, so the last
  /// card always clears the quick-action button and the bottom tabs instead of sliding
  /// underneath them on a short or inset-heavy screen.
  final EdgeInsetsGeometry? padding;
  final Future<void> Function()? refresh;

  @override
  Widget build(BuildContext context) {
    final double bottomInset = MediaQuery.paddingOf(context).bottom;
    final double clearance = FloatingClearance.maybeOf(context) ?? 88;
    // The first card starts below the floating header, and the list scrolls behind it.
    final double top = ChromeInsets.topOf(context);
    final Widget list = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: (padding ?? EdgeInsets.fromLTRB(14, 12, 14, clearance + bottomInset)).add(EdgeInsets.only(top: top)),
      children: <Widget>[
        ContentWidth(
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: constraints.maxWidth >= AppLayout.twoColumnWidth ? arrangeCardRuns(children) : children,
            ),
          ),
        ),
      ],
    );
    if (refresh == null) return list;
    return RefreshIndicator(onRefresh: refresh!, edgeOffset: top, child: list);
  }
}

/// On wide content (landscape tablets) consecutive cards sit in two columns like the
/// desktop website, while headings, filters and banners keep the full width. Phones get
/// the children unchanged.
List<Widget> arrangeCardRuns(List<Widget> children) {
  final List<Widget> out = <Widget>[];
  final List<Widget> run = <Widget>[];
  final List<Widget> gaps = <Widget>[];
  void flush() {
    if (run.length >= 2) {
      out.add(CardColumns(children: List<Widget>.of(run)));
    } else {
      out.addAll(run);
    }
    out.addAll(gaps);
    run.clear();
    gaps.clear();
  }

  for (final Widget child in children) {
    if (child is NotebookCard) {
      // Spacers between two cards are replaced by the grid's own gaps.
      gaps.clear();
      run.add(child);
    } else if (run.isNotEmpty && child is SizedBox && child.child == null) {
      gaps.add(child);
    } else {
      flush();
      out.add(child);
    }
  }
  flush();
  return out;
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
