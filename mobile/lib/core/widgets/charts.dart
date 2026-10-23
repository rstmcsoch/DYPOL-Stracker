import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// A small line chart for test trends. Values are percentages (0…yMax).
class LineSeriesChart extends StatelessWidget {
  const LineSeriesChart({
    super.key,
    required this.points,
    this.height = 132,
    this.labels = const <String>[],
    this.yMax = 100,
    this.showDots = true,
  });

  final List<double> points;
  final double height;
  final List<String> labels;
  final double yMax;
  final bool showDots;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    if (points.isEmpty) {
      return SizedBox(
        height: 60,
        child: Center(
          child: Text(
            'No data yet',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
          ),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SizedBox(
          height: height,
          width: double.infinity,
          child: CustomPaint(
            painter: _LinePainter(
              points: points,
              line: colors.palette.accent,
              grid: colors.palette.chartGrid,
              dot: colors.palette.textAccent,
              yMax: yMax,
              showDots: showDots,
            ),
          ),
        ),
        if (labels.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                Text(
                  labels.first,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                ),
                Text(
                  labels.last,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _LinePainter extends CustomPainter {
  _LinePainter({
    required this.points,
    required this.line,
    required this.grid,
    required this.dot,
    required this.yMax,
    required this.showDots,
  });

  final List<double> points;
  final Color line;
  final Color grid;
  final Color dot;
  final double yMax;
  final bool showDots;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (int row = 0; row <= 4; row += 1) {
      final double y = size.height * row / 4;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    final double step = points.length <= 1 ? 0 : size.width / (points.length - 1);
    final Path path = Path();
    for (int index = 0; index < points.length; index += 1) {
      final double value = points[index].clamp(0, yMax).toDouble();
      final double x = points.length == 1 ? size.width / 2 : step * index;
      final double y = size.height - (value / yMax) * size.height;
      if (index == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }

    final Paint linePaint = Paint()
      ..color = line
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.4
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = StrokeCap.round;
    canvas.drawPath(path, linePaint);

    if (showDots) {
      final Paint dotPaint = Paint()..color = dot;
      for (int index = 0; index < points.length; index += 1) {
        final double value = points[index].clamp(0, yMax).toDouble();
        final double x = points.length == 1 ? size.width / 2 : step * index;
        final double y = size.height - (value / yMax) * size.height;
        canvas.drawCircle(Offset(x, y), 3, dotPaint);
      }
    }
  }

  @override
  bool shouldRepaint(_LinePainter oldDelegate) =>
      oldDelegate.points != points || oldDelegate.yMax != yMax;
}

/// Horizontal bars with a label and caption. Values are 0…1.
class BarList extends StatelessWidget {
  const BarList({super.key, required this.rows, this.unit = ''});

  final List<({String label, double value, String caption})> rows;
  final String unit;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    if (rows.isEmpty) {
      return Text(
        'Nothing recorded yet.',
        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.muted),
      );
    }
    return Column(
      children: <Widget>[
        for (final ({String label, double value, String caption}) row in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 9),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        row.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                    if (row.caption.isNotEmpty)
                      Text(
                        row.caption,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: colors.muted,
                            ),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: Stack(
                    children: <Widget>[
                      Container(height: 6, color: colors.palette.paperMuted),
                      FractionallySizedBox(
                        widthFactor: row.value.isNaN ? 0 : row.value.clamp(0, 1).toDouble(),
                        child: Container(height: 6, color: colors.palette.accent),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// 28-day consistency strip. Each cell is one day, tinted by minutes studied.
class ConsistencyStrip extends StatelessWidget {
  const ConsistencyStrip({super.key, required this.days});

  final List<({String date, int minutes})> days;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final int maxMinutes = days.fold<int>(0, (int acc, ({String date, int minutes}) day) => math.max(acc, day.minutes));
    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: <Widget>[
        for (final ({String date, int minutes}) day in days)
          Tooltip(
            message: '${day.date}: ${day.minutes} min',
            child: Container(
              width: 14,
              height: 14,
              decoration: BoxDecoration(
                color: day.minutes == 0
                    ? colors.palette.paperMuted
                    : colors.palette.accent.withValues(
                        alpha: 0.25 + 0.75 * (maxMinutes == 0 ? 0 : day.minutes / maxMinutes),
                      ),
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: colors.palette.line),
              ),
            ),
          ),
      ],
    );
  }
}
