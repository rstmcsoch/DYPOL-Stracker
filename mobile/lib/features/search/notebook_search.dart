import 'dart:async';
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../data/app_data.dart';
import '../../data/data_controller.dart';
import '../../logic/search.dart';
import '../shell/routes.dart';
import 'search_focus.dart';

/// Opens the notebook search: a compact window centred over a blurred, dimmed page.
/// Closes on the X, on a tap outside it and on Android back. Tapping a result opens the
/// section that owns it, scrolled to (and highlighting) that item.
Future<void> showNotebookSearch(BuildContext context) {
  // The window sits on the app's root navigator so the blur covers the whole screen
  // (sidebar included); the signed-in account's providers are carried over to it.
  final ProviderContainer container = ProviderScope.containerOf(context, listen: false);
  final NavigatorState root = Navigator.of(context, rootNavigator: true);
  return showGeneralDialog<void>(
    context: context,
    useRootNavigator: true,
    barrierDismissible: true,
    barrierLabel: 'Close search',
    barrierColor: Colors.transparent,
    transitionDuration: const Duration(milliseconds: 220),
    pageBuilder: (BuildContext dialogContext, Animation<double> animation, Animation<double> secondary) =>
        UncontrolledProviderScope(
      container: container,
      child: NotebookSearchDialog(
        onOpen: (SearchHit hit) {
          Navigator.of(dialogContext).pop();
          unawaited(Routes.open(
            root.context,
            hit.route,
            fromMenu: true,
            focus: SearchFocus(hit.kind, hit.id),
          ));
        },
      ),
    ),
    transitionBuilder: (BuildContext context, Animation<double> animation, Animation<double> secondary, Widget child) {
      final CurvedAnimation curve = CurvedAnimation(parent: animation, curve: Curves.easeOutCubic);
      return Stack(
        children: <Widget>[
          // Purely visual: taps go through to the route's barrier, which closes the window.
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: curve,
                builder: (BuildContext context, Widget? _) => BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 6 * curve.value, sigmaY: 6 * curve.value),
                  child: ColoredBox(color: Colors.black.withValues(alpha: 0.30 * curve.value)),
                ),
              ),
            ),
          ),
          FadeTransition(
            opacity: curve,
            child: ScaleTransition(scale: Tween<double>(begin: 0.96, end: 1).animate(curve), child: child),
          ),
        ],
      );
    },
  );
}

/// The search window's content. Public for tests.
class NotebookSearchDialog extends ConsumerStatefulWidget {
  const NotebookSearchDialog({super.key, required this.onOpen});

  final ValueChanged<SearchHit> onOpen;

  @override
  ConsumerState<NotebookSearchDialog> createState() => _NotebookSearchDialogState();
}

class _NotebookSearchDialogState extends ConsumerState<NotebookSearchDialog> {
  final TextEditingController _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  static IconData _icon(SearchKind kind) => switch (kind) {
        SearchKind.chapter => Icons.menu_book_outlined,
        SearchKind.test => Icons.checklist,
        SearchKind.mistake => Icons.book_outlined,
        SearchKind.task => Icons.check_circle_outline,
        SearchKind.backlog => Icons.layers_outlined,
        SearchKind.card => Icons.style_outlined,
      };

  void _open(SearchHit hit) {
    unawaited(HapticFeedback.selectionClick());
    widget.onOpen(hit);
  }

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextTheme text = Theme.of(context).textTheme;
    final AppData data = ref.watch(dataControllerProvider).data;
    final String query = _query.text.trim();
    final List<SearchHit> hits = searchNotebook(data, query);
    final MediaQueryData media = MediaQuery.of(context);
    final double available = media.size.height - media.viewInsets.bottom - media.padding.vertical - 32;
    final double maxHeight = (media.size.height * 0.7).clamp(160.0, available < 160 ? 160.0 : available);
    final double width = (media.size.width * 0.9).clamp(0.0, 560.0);

    final Widget results;
    if (query.isEmpty) {
      results = _Hint(
        icon: Icons.manage_search,
        text: 'Search chapters, tests, mistakes, tasks, backlog and cards. Your notes stay private to your account.',
      );
    } else if (hits.isEmpty) {
      results = const _Hint(icon: Icons.search_off, text: 'No matches yet. Try another word.');
    } else {
      results = ListView.builder(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(8, 0, 8, 10),
        itemCount: hits.length,
        itemBuilder: (BuildContext context, int index) {
          final SearchHit hit = hits[index];
          return ListTile(
            key: ValueKey<String>('search-hit-${hit.kind.name}-${hit.id}'),
            dense: true,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            leading: Icon(_icon(hit.kind), size: 20, color: colors.palette.accent),
            title: Text(hit.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.titleSmall),
            subtitle: Text(
              hit.context,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: text.labelSmall?.copyWith(color: colors.muted),
            ),
            trailing: Text(hit.typeLabel, style: text.labelSmall?.copyWith(color: colors.muted)),
            onTap: () => _open(hit),
          );
        },
      );
    }

    return SafeArea(
      child: AnimatedPadding(
        duration: const Duration(milliseconds: 120),
        padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: width, minWidth: width, maxHeight: maxHeight),
            child: Material(
              color: colors.palette.paper,
              elevation: 16,
              shadowColor: Colors.black54,
              clipBehavior: Clip.antiAlias,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(color: colors.palette.line),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 8, 6, 0),
                    child: Row(
                      children: <Widget>[
                        Expanded(child: Text('Search notebook', style: text.headlineSmall)),
                        IconButton(
                          tooltip: 'Close search',
                          onPressed: () => Navigator.of(context).maybePop(),
                          icon: const Icon(Icons.close, size: 20),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 10),
                    child: TextField(
                      key: const ValueKey<String>('notebook-search-field'),
                      controller: _query,
                      autofocus: true,
                      textInputAction: TextInputAction.search,
                      onChanged: (_) => setState(() {}),
                      onSubmitted: (_) {
                        if (hits.isNotEmpty) _open(hits.first);
                      },
                      decoration: InputDecoration(
                        hintText: 'Try ‘Current Electricity’…',
                        prefixIcon: const Icon(Icons.search, size: 20),
                        suffixIcon: query.isEmpty
                            ? null
                            : IconButton(
                                tooltip: 'Clear',
                                icon: const Icon(Icons.close, size: 18),
                                onPressed: () => setState(_query.clear),
                              ),
                      ),
                    ),
                  ),
                  Divider(height: 1, color: colors.palette.line),
                  Flexible(child: results),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 18, color: colors.muted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted)),
          ),
        ],
      ),
    );
  }
}
