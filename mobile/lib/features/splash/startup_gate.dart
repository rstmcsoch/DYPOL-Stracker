import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/wandering_eyes.dart';
import 'splash_page.dart';

/// Startup sequence after Android's native launch frame:
///
/// 1. The branded splash shows for at least [minSplash] (0.5 s), even on a fast phone.
/// 2. As soon as the app is ready after that (the session is restored and the notebook
///    is on screen from this device's copy or the cloud), it opens; usually within 1 s.
/// 3. Not ready by [maxSplash] (1 s; a slow or missing connection on a first sign-in):
///    the full-screen Wandering Eyes loader replaces the splash until it is. There is no
///    "no internet" text: the eyes alone say it is working.
///
/// The app below is built from the first frame (so loading starts at once) and only
/// covered; once opened it is never covered again.
class StartupGate extends StatefulWidget {
  const StartupGate({
    super.key,
    required this.child,
    this.minSplash = const Duration(milliseconds: 500),
    this.maxSplash = const Duration(milliseconds: 1000),
  });

  final Widget child;
  final Duration minSplash;
  final Duration maxSplash;

  @override
  State<StartupGate> createState() => _StartupGateState();
}

/// What the startup cover is showing, for tests.
enum StartupPhase { splash, loader, open }

class _StartupGateState extends State<StartupGate> {
  final ValueNotifier<bool> _ready = ValueNotifier<bool>(false);
  Timer? _minTimer;
  Timer? _maxTimer;
  bool _minElapsed = false;
  bool _maxElapsed = false;
  bool _opened = false;

  @override
  void initState() {
    super.initState();
    _ready.addListener(_update);
    _minTimer = Timer(widget.minSplash, () {
      _minElapsed = true;
      _update();
    });
    _maxTimer = Timer(widget.maxSplash, () {
      _maxElapsed = true;
      _update();
    });
  }

  void _update() {
    if (!mounted || _opened) return;
    setState(() {
      if (_minElapsed && _ready.value) {
        _opened = true;
        _minTimer?.cancel();
        _maxTimer?.cancel();
      }
    });
  }

  @override
  void dispose() {
    _minTimer?.cancel();
    _maxTimer?.cancel();
    _ready.dispose();
    super.dispose();
  }

  StartupPhase get _phase => _opened
      ? StartupPhase.open
      : _maxElapsed
          ? StartupPhase.loader
          : StartupPhase.splash;

  @override
  Widget build(BuildContext context) {
    final StartupPhase phase = _phase;
    return StartupSignal(
      ready: _ready,
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          // Hidden from touch and screen readers until it opens.
          ExcludeSemantics(
            excluding: phase != StartupPhase.open,
            child: IgnorePointer(ignoring: phase != StartupPhase.open, child: widget.child),
          ),
          if (phase == StartupPhase.splash) const SplashPage(key: ValueKey<String>('startup-splash')),
          if (phase == StartupPhase.loader) const StartupLoader(key: ValueKey<String>('startup-loader')),
        ],
      ),
    );
  }
}

/// Lets the screens under [StartupGate] say when the app is ready to show.
class StartupSignal extends InheritedWidget {
  const StartupSignal({super.key, required this.ready, required super.child});

  final ValueNotifier<bool> ready;

  /// Reports readiness after this frame (a no-op without a gate above, as in tests).
  static void report(BuildContext context, bool ready) {
    final StartupSignal? signal = context.getInheritedWidgetOfExactType<StartupSignal>();
    if (signal == null || signal.ready.value == ready) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Once open the app stays open; readiness only ever turns on.
      if (ready) signal.ready.value = true;
    });
  }

  @override
  bool updateShouldNotify(StartupSignal oldWidget) => oldWidget.ready != ready;
}

/// Full-screen loader for a slow start: the Wandering Eyes centred on the page colour, at
/// a prominent size (about 112 dp wide), with no text.
class StartupLoader extends StatelessWidget {
  const StartupLoader({super.key});

  /// Eyes box height; the width is 2.25 times this (112.5 dp).
  static const double eyesHeight = 50;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: context.stracker.palette.bg,
      child: const Center(
        child: WanderingEyes(height: eyesHeight, delay: Duration.zero, semanticLabel: 'Opening Stracker'),
      ),
    );
  }
}
