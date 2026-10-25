import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';

import '../../data/data_controller.dart';

/// Sends the offline queue automatically: when the phone gets a connection back, when
/// the app comes back to the foreground, and (inside [DataController]) on a retry timer
/// with backoff. Also tells the controller when the phone knows it is offline, so saves
/// are queued at once instead of waiting for a request to fail.
class SyncTriggers extends StatefulWidget {
  const SyncTriggers({super.key, required this.controller, required this.child, this.connectivity});

  final DataController controller;
  final Widget child;

  /// Injected in tests; the platform plugin otherwise.
  final Stream<bool>? connectivity;

  @override
  State<SyncTriggers> createState() => _SyncTriggersState();
}

class _SyncTriggersState extends State<SyncTriggers> with WidgetsBindingObserver {
  StreamSubscription<bool>? _subscription;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _subscription = (widget.connectivity ?? _platformConnectivity()).listen(
      (bool online) {
        if (widget.controller.mounted) widget.controller.setNetworkAvailable(online);
      },
      onError: (Object _) {
        // No connectivity plugin (tests, unsupported platform): retries and resume cover it.
      },
    );
  }

  static Stream<bool> _platformConnectivity() async* {
    final Connectivity connectivity = Connectivity();
    bool online(List<ConnectivityResult> results) =>
        results.any((ConnectivityResult result) => result != ConnectivityResult.none);
    yield online(await connectivity.checkConnectivity());
    yield* connectivity.onConnectivityChanged.map(online);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && widget.controller.mounted && widget.controller.pendingWrites.isNotEmpty) {
      unawaited(widget.controller.syncNow());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
