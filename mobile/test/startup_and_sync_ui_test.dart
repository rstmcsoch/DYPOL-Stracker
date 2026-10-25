import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/theme/app_theme.dart';
import 'package:stracker/core/theme/palettes.dart';
import 'package:stracker/core/widgets/wandering_eyes.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/features/home/home_page.dart';
import 'package:stracker/features/splash/splash_page.dart';
import 'package:stracker/features/splash/startup_gate.dart';
import 'package:stracker/features/sync/sync_triggers.dart';

import 'support/app_harness.dart';
import 'support/fake_backend.dart';
import 'support/seed.dart';

/// Stand-in for the app under the gate: reports ready when [ready] turns true.
class _App extends StatelessWidget {
  const _App(this.ready);

  final ValueNotifier<bool> ready;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
        valueListenable: ready,
        builder: (BuildContext context, bool value, _) {
          StartupSignal.report(context, value);
          return const Scaffold(body: Center(child: Text('Notebook')));
        },
      );
}

Future<void> _pumpGate(WidgetTester tester, ValueNotifier<bool> ready, {Size size = const Size(412, 915)}) async {
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = size * 2;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: buildStrackerTheme(palette: strackerPalettes['default']!['light']!, brightness: Brightness.light),
    home: StartupGate(child: _App(ready)),
  ));
}

bool _opened(WidgetTester tester) =>
    find.byType(SplashPage).evaluate().isEmpty && find.byType(StartupLoader).evaluate().isEmpty;

void main() {
  setUpAll(loadAppFonts);

  group('startup', () {
    testWidgets('a fast start still shows the splash for 0.5 s, then opens straight away', (WidgetTester tester) async {
      final ValueNotifier<bool> ready = ValueNotifier<bool>(true);
      await _pumpGate(tester, ready);
      await tester.pump();
      expect(find.byType(SplashPage), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 450));
      expect(find.byType(SplashPage), findsOneWidget, reason: 'never shorter than 0.5 s');
      await tester.pump(const Duration(milliseconds: 60));
      expect(_opened(tester), isTrue);
      expect(find.text('Notebook'), findsOneWidget);
      await tester.pump(const Duration(seconds: 2));
      expect(find.byType(StartupLoader), findsNothing, reason: 'the loader never follows an open app');
    });

    testWidgets('ready between 0.5 and 1 s opens as soon as it is ready, with no loader', (WidgetTester tester) async {
      final ValueNotifier<bool> ready = ValueNotifier<bool>(false);
      await _pumpGate(tester, ready);
      await tester.pump(const Duration(milliseconds: 600));
      expect(find.byType(SplashPage), findsOneWidget);
      ready.value = true;
      await tester.pump();
      await tester.pump();
      expect(_opened(tester), isTrue);
      expect(find.byType(StartupLoader), findsNothing);
    });

    testWidgets('a slow or offline start shows only the eyes after 1 s, no warning text, then opens',
        (WidgetTester tester) async {
      final ValueNotifier<bool> ready = ValueNotifier<bool>(false);
      await _pumpGate(tester, ready);
      await tester.pump(const Duration(milliseconds: 990));
      expect(find.byType(SplashPage), findsOneWidget, reason: 'splash at most about 1 s');
      await tester.pump(const Duration(milliseconds: 20));
      expect(find.byType(StartupLoader), findsOneWidget);
      expect(find.byType(SplashPage), findsNothing);
      await tester.pump(const Duration(seconds: 8));
      expect(find.byType(StartupLoader), findsOneWidget, reason: 'waits as long as it takes');
      // Eyes only: no "no internet" or any other text on the loader.
      expect(find.descendant(of: find.byType(StartupLoader), matching: find.byType(Text)), findsNothing);
      expect(find.textContaining(RegExp('internet|offline|connection', caseSensitive: false)), findsNothing);
      ready.value = true;
      await tester.pump();
      await tester.pump();
      expect(_opened(tester), isTrue);
      expect(find.text('Notebook'), findsOneWidget);
    });

    for (final Size size in const <Size>[Size(360, 780), Size(800, 1280)]) {
      testWidgets('the full-screen eyes are a prominent ~112 dp, centred (${size.width.toInt()} wide)',
          (WidgetTester tester) async {
        final ValueNotifier<bool> ready = ValueNotifier<bool>(false);
        await _pumpGate(tester, ready, size: size);
        await tester.pump(const Duration(milliseconds: 1100));
        final Finder eyes = find.descendant(of: find.byType(StartupLoader), matching: find.byType(WanderingEyes));
        final Size eyesSize = tester.getSize(eyes);
        expect(eyesSize.width, inInclusiveRange(96, 120));
        expect(tester.getCenter(eyes).dx, closeTo(size.width / 2, 1));
        expect(tester.getCenter(eyes).dy, closeTo(size.height / 2, 1));
        // Visible at once (no 300 ms delay): the eyes paint immediately.
        expect(find.descendant(of: eyes, matching: find.byType(CustomPaint)), findsWidgets);
        ready.value = true;
        await tester.pump();
        await tester.pump();
      });
    }

    testWidgets('the app under the cover cannot be tapped before it opens', (WidgetTester tester) async {
      final ValueNotifier<bool> ready = ValueNotifier<bool>(false);
      await _pumpGate(tester, ready);
      await tester.pump(const Duration(milliseconds: 1100));
      expect(find.text('Notebook').hitTestable(), findsNothing);
      ready.value = true;
      await tester.pump();
      await tester.pump();
      expect(find.text('Notebook').hitTestable(), findsOneWidget);
    });
  });

  group('sync pill', () {
    testWidgets('shows a subtle pending count and Sync now sends the queue', (WidgetTester tester) async {
      final FakeBackend backend = FakeBackend()
        ..tables['chapters'] = <Map<String, dynamic>>[chapterRow('c1', 'Current Electricity')];
      late DataController data;
      await tester.runAsync(() async {
        data = await backend.controller();
        await data.load();
        backend.offline = true;
        await data.saveTask(DailyTask.fromMap(taskRow('d1', 'Offline task', '2026-10-25')));
        await data.saveTask(DailyTask.fromMap(taskRow('d2', 'Another', '2026-10-25')));
      });
      expect(data.state.pending, 2);
      final SemanticsHandle semantics = tester.ensureSemantics();
      await pumpSignedIn(tester, const HomePage(), data: data);
      final Finder badge = find.byKey(const ValueKey<String>('sync-pending-count')).first;
      expect(badge, findsOneWidget);
      expect(find.descendant(of: badge, matching: find.text('2')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('2 changes waiting to sync')), findsWidgets);
      expect(tester.getSize(badge).height, lessThanOrEqualTo(16), reason: 'subtle, not a banner');

      backend.offline = false;
      await tester.tap(find.byKey(const ValueKey<String>('sync-now')).first);
      await tester.runAsync(() => pumpEventQueue(times: 100));
      await tester.runAsync(() async {
        while (data.state.pending > 0 || data.state.syncing) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
      });
      await settle(tester);
      expect(data.state.pending, 0);
      expect(
          backend.tables['daily_tasks']!.map((Map<String, dynamic> r) => r['id']), containsAll(<String>['d1', 'd2']));
      expect(find.byKey(const ValueKey<String>('sync-pending-count')), findsNothing);
      semantics.dispose(); // the signed-in scope disposes the controller
    });
  });

  group('sync triggers', () {
    testWidgets('connection back and app resume send the queue automatically', (WidgetTester tester) async {
      final FakeBackend backend = FakeBackend();
      late DataController data;
      await tester.runAsync(() async {
        data = await backend.controller();
        await data.load();
      });
      final StreamController<bool> connectivity = StreamController<bool>();
      addTearDown(connectivity.close);
      await tester.pumpWidget(SyncTriggers(
        controller: data,
        connectivity: connectivity.stream,
        child: const SizedBox(),
      ));

      // Known offline: saved on the phone instantly, nothing sent.
      connectivity.add(false);
      await tester.pump();
      backend.offline = true;
      await tester.runAsync(() => data.saveTask(DailyTask.fromMap(taskRow('d1', 'Offline task', '2026-10-25'))));
      expect(data.state.pending, 1);

      // Connection back: sent without the user doing anything.
      backend.offline = false;
      connectivity.add(true);
      await tester.pump();
      await tester.runAsync(() async {
        while (data.state.pending > 0) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
      });
      expect(backend.tables['daily_tasks']!.single['id'], 'd1');

      // App resume also sends anything waiting.
      connectivity.add(false);
      await tester.pump();
      await tester.runAsync(() => data.saveTask(DailyTask.fromMap(taskRow('d2', 'While away', '2026-10-25'))));
      expect(data.state.pending, 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.runAsync(() async {
        while (data.state.pending > 0) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
      });
      expect(
          backend.tables['daily_tasks']!.map((Map<String, dynamic> r) => r['id']), containsAll(<String>['d1', 'd2']));
      await tester.pumpWidget(const SizedBox());
      data.dispose();
    });
  });
}
