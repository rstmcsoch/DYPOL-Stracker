import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_theme.dart';

/// Paper card: the notebook's base surface. Optional ruled title and an action slot.
class NotebookCard extends StatelessWidget {
  const NotebookCard({
    super.key,
    required this.child,
    this.title,
    this.subtitle,
    this.action,
    this.trailing,
    this.actionHint = false,
    this.accent,
    this.padding = const EdgeInsets.all(14),
    this.dense = false,
    this.onTap,
  });

  final Widget child;
  final String? title;
  final String? subtitle;
  final Widget? action;

  /// Trailing control in the card's title row. Same slot as [action]; both are accepted
  /// because different pages name the affordance differently.
  final Widget? trailing;
  final bool actionHint;
  final Color? accent;
  final EdgeInsetsGeometry padding;
  final bool dense;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final Widget body = Padding(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (title != null || action != null || trailing != null)
            Padding(
              padding: EdgeInsets.only(bottom: dense ? 6 : 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        if (title != null)
                          Text(
                            title!,
                            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                  fontSize: dense ? 15.5 : 18,
                                ),
                          ),
                        if (subtitle != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              subtitle!,
                              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: colors.muted,
                                  ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (action != null) action!,
                  if (action == null && trailing != null) trailing!,
                ],
              ),
            ),
          child,
        ],
      ),
    );

    return Material(
      color: colors.palette.paper,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: accent == null
                ? Border.all(color: colors.palette.line)
                : Border(
                    top: BorderSide(color: colors.palette.line),
                    right: BorderSide(color: colors.palette.line),
                    bottom: BorderSide(color: colors.palette.line),
                    left: BorderSide(color: accent!, width: 3),
                  ),
          ),
          child: body,
        ),
      ),
    );
  }
}

/// A page heading inside a body (the app bar already carries the section name on
/// pushed pages, so headings are for tab pages and sub-sections).
class PageHeading extends StatelessWidget {
  const PageHeading({
    super.key,
    required this.title,
    this.subtitle,
    this.eyebrow,
    this.action,
  });

  final String title;
  final String? subtitle;
  final String? eyebrow;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (eyebrow != null)
                  Text(
                    eyebrow!.toUpperCase(),
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: colors.palette.accent,
                          letterSpacing: 1.4,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                Text(title, style: Theme.of(context).textTheme.headlineLarge),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      subtitle!,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
                    ),
                  ),
              ],
            ),
          ),
          if (action != null) action!,
        ],
      ),
    );
  }
}

class SectionHeading extends StatelessWidget {
  const SectionHeading(this.label, {super.key, this.trailing, this.padding});

  final String label;
  final Widget? trailing;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Padding(
      padding: padding ?? const EdgeInsets.fromLTRB(2, 14, 2, 8),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              label.toUpperCase(),
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: colors.muted,
                    letterSpacing: 1.3,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

enum PillTone { neutral, accent, good, warn, bad }

/// Small status pill. Monospaced-ish uppercase label with a tinted background.
class Pill extends StatelessWidget {
  const Pill(
    this.label, {
    super.key,
    this.tone = PillTone.neutral,
    this.icon,
    this.dense = false,
    this.onTap,
  });

  final String label;
  final PillTone tone;
  final IconData? icon;
  final bool dense;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final (Color fg, Color bg) = switch (tone) {
      PillTone.accent => (colors.palette.textAccent, colors.palette.accentLight),
      PillTone.good => (colors.palette.green, colors.palette.greenBg),
      PillTone.warn => (colors.palette.orange, colors.palette.orangeBg),
      PillTone.bad => (colors.palette.red, colors.palette.redBg),
      PillTone.neutral => (colors.palette.inkSoft, colors.palette.paperMuted),
    };
    final Widget body = Container(
      padding: EdgeInsets.symmetric(horizontal: dense ? 7 : 9, vertical: dense ? 3 : 4.5),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: dense ? 11 : 12.5, color: fg),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              fontFamily: 'Lexend',
              fontSize: dense ? 10.5 : 11.5,
              fontWeight: FontWeight.w500,
              color: fg,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return body;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: body,
    );
  }
}

/// A tiny press animation for anything tappable that is not already a button: the surface
/// sinks to 98 % and comes back on release, with the light tick Android uses for a tap.
/// Wrap a card, tile or chip; it keeps the child's own layout and ink.
class TapScale extends StatefulWidget {
  const TapScale({super.key, required this.child, this.onTap, this.haptic = true});

  final Widget child;
  final VoidCallback? onTap;
  final bool haptic;

  @override
  State<TapScale> createState() => _TapScaleState();
}

class _TapScaleState extends State<TapScale> {
  bool _down = false;

  void _set(bool down) {
    if (!mounted || _down == down) return;
    setState(() => _down = down);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: widget.onTap == null ? null : (_) => _set(true),
      onTapCancel: widget.onTap == null ? null : () => _set(false),
      onTapUp: widget.onTap == null
          ? null
          : (_) {
              _set(false);
              if (widget.haptic) HapticFeedback.selectionClick();
              widget.onTap!();
            },
      onTap: widget.onTap == null ? null : () {}, // keeps semantics tap-able
      child: AnimatedScale(
        scale: _down ? 0.98 : 1,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
        child: widget.child,
      ),
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.value,
    required this.label,
    this.hint,
    this.tone,
    this.onTap,
  });

  final String value;
  final String label;
  final String? hint;
  final Color? tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    // One gesture owner for the whole tile: the press animation and the tap cannot fight
    // over the same pointer.
    return TapScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: colors.palette.paperSoft,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: colors.palette.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              value,
              style: TextStyle(
                fontFamily: 'PatrickHand',
                fontSize: 24,
                height: 1.05,
                color: tone ?? colors.palette.ink,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.inkSoft),
            ),
            if (hint != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  hint!,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: colors.muted,
                        fontSize: 10.5,
                      ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Simple horizontal progress bar. `value` is 0…1 (not a percentage).
class LinearBar extends StatelessWidget {
  const LinearBar({
    super.key,
    required this.value,
    this.height = 7,
    this.color,
    this.track,
    this.label,
  });

  final double value;
  final double height;
  final Color? color;
  final Color? track;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final double clamped = value.isNaN ? 0 : value.clamp(0, 1).toDouble();
    return ClipRRect(
      borderRadius: BorderRadius.circular(height),
      child: Stack(
        children: <Widget>[
          Container(height: height, color: track ?? colors.palette.paperMuted),
          FractionallySizedBox(
            widthFactor: clamped,
            child: Container(height: height, color: color ?? colors.palette.accent),
          ),
        ],
      ),
    );
  }
}

/// Circular completion ring. `value` is 0…100 (a percentage), as stored everywhere else.
class ProgressRing extends StatelessWidget {
  const ProgressRing({
    super.key,
    required this.value,
    this.size = 76,
    this.stroke = 8,
    this.center,
    this.color,
  });

  final double? value;
  final double size;
  final double stroke;
  final Widget? center;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final double progress = (value ?? 0).isNaN ? 0 : (value ?? 0).clamp(0, 100).toDouble() / 100;
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: <Widget>[
          SizedBox(
            width: size,
            height: size,
            child: CircularProgressIndicator(
              value: progress,
              strokeWidth: stroke,
              strokeCap: StrokeCap.round,
              backgroundColor: colors.palette.ringTrack,
              valueColor: AlwaysStoppedAnimation<Color>(color ?? colors.palette.accent),
            ),
          ),
          center ??
              Text(
                '${(progress * 100).round()}%',
                style: TextStyle(
                  fontFamily: 'PatrickHand',
                  fontSize: size * 0.26,
                  color: colors.palette.ink,
                ),
              ),
        ],
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.title,
    this.message,
    this.icon = Icons.inbox_outlined,
    this.action,
  });

  final String title;
  final String? message;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 6),
      child: Column(
        children: <Widget>[
          Icon(icon, size: 30, color: colors.palette.lineStrong),
          const SizedBox(height: 8),
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          if (message != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                message!,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
              ),
            ),
          if (action != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: action!,
            ),
        ],
      ),
    );
  }
}

class ErrorNotice extends StatelessWidget {
  const ErrorNotice(this.message, {super.key, this.onRetry, this.retryLabel = 'Try again'});

  final String message;
  final VoidCallback? onRetry;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.palette.redBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.palette.red.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.error_outline, size: 18, color: colors.palette.red),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.palette.red),
            ),
          ),
          if (onRetry != null)
            TextButton(
              onPressed: onRetry,
              child: Text(retryLabel, style: TextStyle(color: colors.palette.red)),
            ),
        ],
      ),
    );
  }
}

class InfoBanner extends StatelessWidget {
  const InfoBanner(
    this.message, {
    super.key,
    this.icon = Icons.info_outline,
    this.tone = PillTone.accent,
  });

  final String message;
  final IconData icon;
  final PillTone tone;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final (Color fg, Color bg) = switch (tone) {
      PillTone.warn => (colors.palette.orange, colors.palette.orangeBg),
      PillTone.bad => (colors.palette.red, colors.palette.redBg),
      PillTone.good => (colors.palette.green, colors.palette.greenBg),
      _ => (colors.palette.textAccent, colors.palette.accentLight),
    };
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 16, color: fg),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: fg, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

/// Skeletons for the first load, so the screen never flashes an empty state over real data.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.rows = 4});

  final int rows;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Column(
      children: <Widget>[
        for (int index = 0; index < rows; index += 1)
          Container(
            height: 78,
            margin: const EdgeInsets.only(bottom: 10),
            decoration: BoxDecoration(
              color: colors.palette.paper,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: colors.palette.line),
            ),
          ),
      ],
    );
  }
}

/// Constrains content width on tablets and keeps page padding consistent.
class ContentWidth extends StatelessWidget {
  const ContentWidth({super.key, required this.child, this.maxWidth = 760});

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: child,
      ),
    );
  }
}

/// Responsive grid: chips/tiles sized by available width rather than a fixed count, which
/// keeps small phones readable and large tablets from stretching.
class WrapGrid extends StatelessWidget {
  const WrapGrid({
    super.key,
    required this.children,
    this.spacing = 8,
    this.runSpacing = 8,
    this.minItemWidth = 150,
  });

  final List<Widget> children;
  final double spacing;
  final double runSpacing;
  final double minItemWidth;

  @override
  Widget build(BuildContext context) {
    if (children.isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double width = constraints.maxWidth;
        final int columns = (width / (minItemWidth + spacing)).floor().clamp(1, 4);
        // Subtract the gaps, then distribute the rest evenly.
        final double itemWidth = (width - spacing * (columns - 1)) / columns;
        return Wrap(
          spacing: spacing,
          runSpacing: runSpacing,
          children: <Widget>[
            for (final Widget child in children)
              SizedBox(width: itemWidth, child: child),
          ],
        );
      },
    );
  }
}
