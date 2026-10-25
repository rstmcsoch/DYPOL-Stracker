import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../logic/search.dart';

/// The item a section was opened for from the notebook search. The section scrolls to it
/// and highlights it once ([claim] only answers true the first time).
class SearchFocus {
  SearchFocus(this.kind, this.id);

  final SearchKind kind;
  final String id;
  bool _claimed = false;

  bool get claimed => _claimed;

  /// True once, for the widget showing [itemId], if it is the searched item.
  bool claim(String itemId) {
    if (_claimed || itemId != id) return false;
    _claimed = true;
    return true;
  }
}

/// Hands a [SearchFocus] to the section page opened from a search result.
class SearchFocusScope extends InheritedWidget {
  const SearchFocusScope({super.key, required this.focus, required super.child});

  final SearchFocus? focus;

  /// The search target for this section, if it was opened from a search result.
  static SearchFocus? of(BuildContext context) => context.getInheritedWidgetOfExactType<SearchFocusScope>()?.focus;

  @override
  bool updateShouldNotify(SearchFocusScope oldWidget) => !identical(oldWidget.focus, focus);
}

/// Wraps one item of a section (a chapter, a test, a mistake...). When the section was
/// opened for this item from the search, it is scrolled into view and outlined for a
/// moment so the student sees exactly where the result is.
class SearchTarget extends StatefulWidget {
  const SearchTarget({super.key, required this.id, required this.child, this.radius = 18});

  final String id;
  final Widget child;
  final double radius;

  @override
  State<SearchTarget> createState() => SearchTargetState();
}

class SearchTargetState extends State<SearchTarget> {
  bool _lit = false;
  Timer? _fade;

  /// Whether the highlight is showing (for tests).
  bool get highlighted => _lit;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeFocus());
  }

  void _maybeFocus() {
    if (!mounted) return;
    final SearchFocus? focus = SearchFocusScope.of(context);
    if (focus == null || !focus.claim(widget.id)) return;
    setState(() => _lit = true);
    unawaited(Scrollable.ensureVisible(
      context,
      alignment: 0.3,
      duration: const Duration(milliseconds: 450),
      curve: Curves.easeOutCubic,
    ));
    _fade = Timer(const Duration(milliseconds: 2800), () {
      if (mounted) setState(() => _lit = false);
    });
  }

  @override
  void dispose() {
    _fade?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final Color accent = context.stracker.palette.accent;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 350),
      foregroundDecoration: BoxDecoration(
        borderRadius: BorderRadius.circular(widget.radius),
        border: Border.all(color: _lit ? accent : accent.withValues(alpha: 0), width: 2.5),
      ),
      child: widget.child,
    );
  }
}
