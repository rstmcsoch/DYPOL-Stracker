import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// One line in [MultiLineChart]. `values` line up with the chart's `times`; null is a gap
/// (the website's connectNulls={false}).
class ChartSeries {
  const ChartSeries({required this.label, required this.color, required this.values, this.dashed = false});
  final String label;
  final Color color;
  final List<double?> values;
  final bool dashed;
}

/// Percentage trend with several series on a real time axis (a 13-day gap takes 13 days of
/// space), the website's Marks & subjects line chart. Drawn with a CustomPainter, no library.
class MultiLineChart extends StatelessWidget {
  const MultiLineChart({
    super.key,
    required this.times,
    required this.series,
    required this.tickLabel,
    this.height = 200,
  });

  /// Milliseconds since epoch, ascending.
  final List<int> times;
  final List<ChartSeries> series;
  final String Function(int time) tickLabel;
  final double height;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final TextStyle label = Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted) ?? const TextStyle();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Semantics(
          label: 'Marks trend chart, ${series.length} series over ${times.length} tests',
          child: SizedBox(
            height: height,
            width: double.infinity,
            child: CustomPaint(
              painter: _MultiLinePainter(
                times: times,
                series: series,
                grid: colors.palette.chartGrid,
                labelStyle: label,
                tickLabel: tickLabel,
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 12,
          runSpacing: 4,
          children: <Widget>[
            for (final ChartSeries s in series)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Container(
                    width: 14,
                    height: 3,
                    decoration: BoxDecoration(color: s.color, borderRadius: BorderRadius.circular(2)),
                  ),
                  const SizedBox(width: 5),
                  Text(s.label, style: label),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

class _MultiLinePainter extends CustomPainter {
  _MultiLinePainter({
    required this.times,
    required this.series,
    required this.grid,
    required this.labelStyle,
    required this.tickLabel,
  });

  final List<int> times;
  final List<ChartSeries> series;
  final Color grid;
  final TextStyle labelStyle;
  final String Function(int time) tickLabel;

  static const double _left = 34;
  static const double _bottom = 20;
  static const double _top = 8;
  static const double _right = 10;

  @override
  void paint(Canvas canvas, Size size) {
    final double width = size.width - _left - _right;
    final double height = size.height - _top - _bottom;
    if (width <= 0 || height <= 0 || times.isEmpty) return;
    final Paint gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (int step = 0; step <= 4; step += 1) {
      final double y = _top + height - height * step / 4;
      _dashedLine(canvas, Offset(_left, y), Offset(_left + width, y), gridPaint, 3, 5);
      _text(canvas, '${step * 25}', Offset(0, y - 7), 28, TextAlign.right);
    }
    final int first = times.first;
    final int span = math.max(1, times.last - first);
    double xOf(int index) => times.length == 1 ? _left + width / 2 : _left + width * (times[index] - first) / span;
    double yOf(double value) => _top + height - height * value.clamp(0, 100) / 100;

    // Up to four ticks, skipping labels that would collide.
    double lastTickRight = -1000;
    final int tickCount = math.min(4, times.length);
    for (int t = 0; t < tickCount; t += 1) {
      final int index = tickCount == 1 ? 0 : ((times.length - 1) * t / (tickCount - 1)).round();
      final double x = xOf(index);
      final String text = tickLabel(times[index]);
      if (x - 24 < lastTickRight) continue;
      _text(canvas, text, Offset(x - 24, _top + height + 5), 48, TextAlign.center);
      lastTickRight = x + 24;
    }

    for (final ChartSeries s in series) {
      final Paint line = Paint()
        ..color = s.color
        ..strokeWidth = s.dashed ? 2.5 : 2
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;
      final Paint dot = Paint()..color = s.color;
      Offset? previous;
      for (int i = 0; i < times.length && i < s.values.length; i += 1) {
        final double? value = s.values[i];
        if (value == null) {
          previous = null;
          continue;
        }
        final Offset point = Offset(xOf(i), yOf(value));
        if (previous != null) {
          if (s.dashed) {
            _dashedLine(canvas, previous, point, line, 7, 5);
          } else {
            canvas.drawLine(previous, point, line);
          }
        }
        canvas.drawCircle(point, s.dashed ? 3.5 : 3, dot);
        previous = point;
      }
    }
  }

  void _dashedLine(Canvas canvas, Offset a, Offset b, Paint paint, double dash, double gap) {
    final double length = (b - a).distance;
    if (length == 0) return;
    final Offset unit = (b - a) / length;
    double run = 0;
    while (run < length) {
      final double end = math.min(run + dash, length);
      canvas.drawLine(a + unit * run, a + unit * end, paint);
      run = end + gap;
    }
  }

  void _text(Canvas canvas, String text, Offset at, double width, TextAlign align) {
    final TextPainter painter = TextPainter(
      text: TextSpan(text: text, style: labelStyle),
      textAlign: align,
      textDirection: TextDirection.ltr,
      maxLines: 1,
      ellipsis: '…',
    )..layout(minWidth: width, maxWidth: width);
    painter.paint(canvas, at);
  }

  @override
  bool shouldRepaint(_MultiLinePainter old) => old.times != times || old.series != series || old.grid != grid;
}

/// Subject balance radar (the website's RadarChart): one axis per subject, 0–100%.
class RadarChart extends StatelessWidget {
  const RadarChart({super.key, required this.labels, required this.values, this.size = 230});

  final List<String> labels;
  final List<double> values;
  final double size;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Semantics(
      label: 'Subject balance: '
          '${<String>[for (int i = 0; i < labels.length; i += 1) '${labels[i]} ${values[i].round()}%'].join(', ')}',
      child: SizedBox(
        height: size,
        width: double.infinity,
        child: CustomPaint(
          painter: _RadarPainter(
            labels: labels,
            values: values,
            grid: colors.palette.chartGrid,
            fill: colors.palette.accent,
            labelStyle:
                Theme.of(context).textTheme.labelMedium?.copyWith(color: colors.palette.inkSoft) ?? const TextStyle(),
          ),
        ),
      ),
    );
  }
}

class _RadarPainter extends CustomPainter {
  _RadarPainter({
    required this.labels,
    required this.values,
    required this.grid,
    required this.fill,
    required this.labelStyle,
  });

  final List<String> labels;
  final List<double> values;
  final Color grid;
  final Color fill;
  final TextStyle labelStyle;

  @override
  void paint(Canvas canvas, Size size) {
    final int n = labels.length;
    if (n == 0) return;
    final Offset centre = size.center(Offset.zero);
    final double radius = math.min(size.width, size.height) / 2 * 0.70;
    Offset at(int i, double fraction) {
      final double angle = -math.pi / 2 + 2 * math.pi * i / n;
      return centre + Offset(math.cos(angle), math.sin(angle)) * radius * fraction;
    }

    final Paint gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;
    for (final double ring in <double>[0.25, 0.5, 0.75, 1]) {
      if (n < 3) {
        canvas.drawCircle(centre, radius * ring, gridPaint);
      } else {
        final Path path = Path()..moveTo(at(0, ring).dx, at(0, ring).dy);
        for (int i = 1; i < n; i += 1) {
          path.lineTo(at(i, ring).dx, at(i, ring).dy);
        }
        canvas.drawPath(path..close(), gridPaint);
      }
    }
    for (int i = 0; i < n; i += 1) {
      canvas.drawLine(centre, at(i, 1), gridPaint);
    }
    final Path shape = Path();
    for (int i = 0; i < n; i += 1) {
      final Offset p = at(i, (values[i] / 100).clamp(0, 1).toDouble());
      if (i == 0) {
        shape.moveTo(p.dx, p.dy);
      } else {
        shape.lineTo(p.dx, p.dy);
      }
    }
    shape.close();
    canvas.drawPath(shape, Paint()..color = fill.withValues(alpha: 0.32));
    canvas.drawPath(
      shape,
      Paint()
        ..color = fill
        ..strokeWidth = 2.5
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round,
    );
    for (int i = 0; i < n; i += 1) {
      final Offset edge = at(i, 1.16);
      final TextPainter painter = TextPainter(
        text: TextSpan(text: labels[i], style: labelStyle),
        textAlign: TextAlign.center,
        textDirection: TextDirection.ltr,
        maxLines: 1,
        ellipsis: '…',
      )..layout(maxWidth: math.max(40, size.width / 3));
      final double x = (edge.dx - painter.width / 2).clamp(0, math.max(0, size.width - painter.width)).toDouble();
      final double y = (edge.dy - painter.height / 2).clamp(0, math.max(0, size.height - painter.height)).toDouble();
      painter.paint(canvas, Offset(x, y));
    }
  }

  @override
  bool shouldRepaint(_RadarPainter old) => old.values != values || old.labels != labels || old.fill != fill;
}
