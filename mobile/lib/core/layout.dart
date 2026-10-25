import 'package:flutter/widgets.dart';

/// Window-size rules shared by the shell and the pages. Everything is computed from the
/// live window (MediaQuery / LayoutBuilder), so rotation, resizing and split-screen
/// rebuild the layout without restarting anything.
///
/// - Phones (any orientation) and tablets in portrait: the floating bottom tab bar.
/// - Tablets in landscape (Material "expanded": 840 dp and wider, with a tablet-sized
///   shortest side): the website's desktop sidebar instead of the bottom bar.
/// - Content never stretches edge to edge: it is capped like the desktop website.
abstract final class AppLayout {
  /// Material 3 "expanded" window class starts here.
  static const double expandedWidth = 840;

  /// A shortest side of 600 dp or more is a tablet (Material's sw600dp qualifier).
  static const double tabletShortestSide = 600;

  /// The desktop website's content column.
  static const double contentMaxWidth = 1160;

  /// From this content width, card sections use two columns.
  static const double twoColumnWidth = 880;

  /// Width of the permanent sidebar on landscape tablets.
  static const double sidebarWidth = 272;

  static bool useSidebar(Size size) => size.width >= expandedWidth && size.shortestSide >= tabletShortestSide;
}

/// Lays card sections out like the desktop website: one column on phones, two balanced
/// columns once the content is wide enough. Children keep their order (left column takes
/// the even ones), so reading order stays the same as on a phone.
class CardColumns extends StatelessWidget {
  const CardColumns({super.key, required this.children, this.spacing = 12});

  final List<Widget> children;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        if (constraints.maxWidth < AppLayout.twoColumnWidth || children.length < 2) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              for (int i = 0; i < children.length; i++) ...<Widget>[
                if (i > 0) SizedBox(height: spacing),
                children[i],
              ],
            ],
          );
        }
        Widget column(int parity) => Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  for (int i = parity; i < children.length; i += 2) ...<Widget>[
                    if (i > parity) SizedBox(height: spacing),
                    children[i],
                  ],
                ],
              ),
            );
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[column(0), SizedBox(width: spacing), column(1)],
        );
      },
    );
  }
}
