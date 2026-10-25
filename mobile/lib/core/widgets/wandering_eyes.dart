import 'dart:async';
import 'dart:ui' show lerpDouble;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// The app's one loading indicator: loading-ui's "Wandering eyes" (two eyes that look left,
/// right and down and blink), drawn with a single [CustomPainter] and one
/// [AnimationController]. The geometry and the 10 s look-and-blink cycle follow the
/// component's CSS: eye = 62 % of the height, gap = 9 %, pupil radius = 32 % of the eye,
/// travel = 31.25 % of the eye, and a blink squeezes the eye to 37.5 %.
///
/// It is only shown when something actually takes time: nothing is painted for [delay]
/// (300 ms), so a quick load never flashes a loader. With reduced motion the eyes stay
/// still, looking ahead.
class WanderingEyes extends StatefulWidget {
  const WanderingEyes({
    super.key,
    this.height = 24,
    this.delay = const Duration(milliseconds: 300),
    this.color,
    this.semanticLabel = 'Loading',
  });

  /// Height of the 9:4 box; the width is 2.25 times this.
  final double height;

  /// How long to wait before appearing. [Duration.zero] shows it at once.
  final Duration delay;

  /// Pupil colour; the eye is the same colour at 16 % opacity. Defaults to the palette ink.
  final Color? color;

  final String semanticLabel;

  @override
  State<WanderingEyes> createState() => _WanderingEyesState();
}

class _WanderingEyesState extends State<WanderingEyes> with SingleTickerProviderStateMixin {
  static const Duration _cycle = Duration(seconds: 10);

  late final AnimationController _controller = AnimationController(vsync: this, duration: _cycle);
  Timer? _timer;
  bool _visible = false;

  @override
  void initState() {
    super.initState();
    if (widget.delay == Duration.zero) {
      _visible = true;
    } else {
      _timer = Timer(widget.delay, () {
        if (mounted) setState(() => _visible = true);
      });
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  void _sync() {
    final bool still = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (!_visible || still) {
      if (_controller.isAnimating) _controller.stop();
      if (still) _controller.value = 0;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _sync();
    final double width = widget.height * 2.25;
    if (!_visible) return SizedBox(width: width, height: widget.height);
    final Color pupil = widget.color ?? context.stracker.palette.ink;
    return Semantics(
      label: widget.semanticLabel,
      liveRegion: true,
      child: RepaintBoundary(
        child: CustomPaint(
          size: Size(width, widget.height),
          painter: _EyesPainter(_controller, pupil: pupil, eye: pupil.withValues(alpha: 0.16)),
        ),
      ),
    );
  }
}

class _EyesPainter extends CustomPainter {
  _EyesPainter(this.animation, {required this.pupil, required this.eye}) : super(repaint: animation);

  final Animation<double> animation;
  final Color pupil;
  final Color eye;

  // (percent, x, y) for the gaze; x/y are multiples of the travel distance.
  static const List<(double, double, double)> _gaze = <(double, double, double)>[
    (0, 0, 0),
    (10, 0, 0),
    (13, -1, 0),
    (40, -1, 0),
    (43, 1, 0),
    (70, 1, 0),
    (73, 0, 1),
    (90, 0, 1),
    (93, 0, 0),
    (100, 0, 0),
  ];

  // Percent marks where the eye is fully closed to the blink height; open one point either side.
  static const List<double> _blinks = <double>[11, 21, 41, 61, 71, 91, 99];

  static (double, double) gazeAt(double percent) {
    for (int i = 1; i < _gaze.length; i += 1) {
      final (double p1, double x1, double y1) = _gaze[i];
      if (percent <= p1) {
        final (double p0, double x0, double y0) = _gaze[i - 1];
        final double t = p1 == p0 ? 1 : Curves.ease.transform(((percent - p0) / (p1 - p0)).clamp(0, 1));
        return (lerpDouble(x0, x1, t)!, lerpDouble(y0, y1, t)!);
      }
    }
    return (0, 0);
  }

  /// 1 = open, [closed] = mid-blink.
  static double opennessAt(double percent, double closed) {
    for (final double mark in _blinks) {
      final double distance = (percent - mark).abs();
      if (distance < 1) return lerpDouble(closed, 1, Curves.ease.transform(distance))!;
    }
    return 1;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final double h = size.shortestSide;
    final double e = h * 0.62;
    final double gap = h * 0.09;
    final double radius = e * 0.32;
    final double travel = e * 0.3125;
    final double percent = animation.value * 100;
    final (double gx, double gy) = gazeAt(percent);
    final double eyeHeight = e * opennessAt(percent, 0.375);
    final Paint eyePaint = Paint()..color = eye;
    final Paint pupilPaint = Paint()
      ..color = pupil
      ..isAntiAlias = true;
    final double left = (size.width - (e * 2 + gap)) / 2;
    for (int i = 0; i < 2; i += 1) {
      final Offset centre = Offset(left + e / 2 + i * (e + gap), size.height / 2);
      final RRect shape = RRect.fromRectAndRadius(
        Rect.fromCenter(center: centre, width: e, height: eyeHeight),
        Radius.circular(eyeHeight / 2),
      );
      canvas.save();
      canvas.clipRRect(shape);
      canvas.drawRRect(shape, eyePaint);
      canvas.drawCircle(centre + Offset(gx * travel, gy * travel), radius, pupilPaint);
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_EyesPainter oldDelegate) =>
      oldDelegate.pupil != pupil || oldDelegate.eye != eye || oldDelegate.animation != animation;
}

/// A centred [WanderingEyes] with an optional caption, for whole-page or panel loads.
class LoadingBlock extends StatelessWidget {
  const LoadingBlock({super.key, this.message, this.height = 32});

  final String? message;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            WanderingEyes(height: height, semanticLabel: message ?? 'Loading'),
            if (message != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                message!,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(color: context.stracker.muted),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
