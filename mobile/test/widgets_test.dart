import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/theme/app_theme.dart';
import 'package:stracker/core/theme/palettes.dart';
import 'package:stracker/core/widgets/charts.dart';
import 'package:stracker/core/widgets/notebook.dart';

Widget host(Widget child, {Brightness brightness = Brightness.light, double textScale = 1}) {
  final StrackerPalette palette = strackerPalettes['default']![
      brightness == Brightness.dark ? 'dark' : 'light']!;
  return MaterialApp(
    theme: buildStrackerTheme(palette: palette, brightness: brightness),
    home: Builder(
      builder: (BuildContext context) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    ),
  );
}

void main() {
  testWidgets('the notebook card renders its title, subtitle and trailing slot', (WidgetTester tester) async {
    await tester.pumpWidget(host(NotebookCard(
      title: 'Today',
      subtitle: 'Saturday',
      trailing: const Icon(Icons.more_horiz),
      child: const Text('Two revisions are due'),
    )));
    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Saturday'), findsOneWidget);
    expect(find.text('Two revisions are due'), findsOneWidget);
    expect(find.byIcon(Icons.more_horiz), findsOneWidget);
  });

  testWidgets('headings, pills and stat tiles show their text', (WidgetTester tester) async {
    await tester.pumpWidget(host(Column(children: <Widget>[
      const PageHeading(title: 'Analytics', subtitle: 'Last 30 days', eyebrow: 'DYPOL LABS'),
      const SectionHeading('Weak chapters'),
      Pill('Overdue', tone: PillTone.bad),
      const StatTile(value: '68%', label: 'Average', hint: '12 tests'),
    ])));
    expect(find.text('Analytics'), findsOneWidget);
    expect(find.text('WEAK CHAPTERS'), findsOneWidget);
    expect(find.text('Overdue'), findsOneWidget);
    expect(find.text('68%'), findsOneWidget);
  });

  testWidgets('an empty state offers its action', (WidgetTester tester) async {
    bool tapped = false;
    await tester.pumpWidget(host(EmptyState(
      title: 'No tests logged',
      message: 'Log your first test to see trends.',
      icon: Icons.fact_check_outlined,
      action: TextButton(onPressed: () => tapped = true, child: const Text('Log a test')),
    )));
    expect(find.text('No tests logged'), findsOneWidget);
    await tester.tap(find.text('Log a test'));
    expect(tapped, isTrue);
  });

  testWidgets('progress widgets clamp out-of-range values', (WidgetTester tester) async {
    await tester.pumpWidget(host(const Column(children: <Widget>[
      LinearBar(value: 140, label: 'Weighted'),
      LinearBar(value: -20, label: 'Raw'),
      ProgressRing(value: 250, center: Text('A')),
    ])));
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty chart draws a placeholder instead of a broken frame', (WidgetTester tester) async {
    await tester.pumpWidget(host(const LineSeriesChart(points: <double>[])));
    expect(tester.takeException(), isNull);
  });

  testWidgets('the chart renders real points', (WidgetTester tester) async {
    await tester.pumpWidget(host(const LineSeriesChart(
      points: <double>[40, 55, 52, 66, 71],
      labels: <String>['T1', 'T2', 'T3', 'T4', 'T5'],
    )));
    expect(tester.takeException(), isNull);
    expect(find.byType(CustomPaint), findsWidgets);
  });

  testWidgets('night mode builds a dark theme', (WidgetTester tester) async {
    late ThemeData theme;
    await tester.pumpWidget(MaterialApp(
      theme: buildStrackerTheme(
        palette: strackerPalettes['default']!['dark']!,
        brightness: Brightness.dark,
      ),
      home: Builder(builder: (BuildContext context) {
        theme = Theme.of(context);
        return const Scaffold(body: Text('night'));
      }),
    ));
    expect(theme.brightness, Brightness.dark);
    expect(find.text('night'), findsOneWidget);
  });

  testWidgets('the layout survives the largest supported text scale', (WidgetTester tester) async {
    await tester.pumpWidget(host(
      const NotebookCard(
        title: 'A very long notebook title that must wrap rather than overflow',
        child: Text('Body copy that also has to wrap when the reader uses a large font.'),
      ),
      textScale: 1.6,
    ));
    expect(tester.takeException(), isNull);
  });
}
