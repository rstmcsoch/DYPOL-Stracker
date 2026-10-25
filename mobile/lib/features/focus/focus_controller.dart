import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';
import '../../logic/focus.dart';

/// Outcome of a save, so the page can show the right message.
class FocusSaveResult {
  const FocusSaveResult(this.minutes, {this.error});
  final int minutes;
  final String? error;
}

/// The one focus timer for the signed-in account.
///
/// It lives in the account's provider container rather than inside FocusPage, so a block
/// keeps running (or stays paused) when the student opens Home or any other screen, and
/// Home can show it without starting a second ticker. Only one periodic ticker exists, and
/// it runs only while a block is running and the app is in the foreground. The state is
/// also written to this device so a process restart restores the open block.
class FocusController extends StateNotifier<FocusTimerState> with WidgetsBindingObserver {
  FocusController(this._ref) : super(const FocusTimerState()) {
    final DataController data = _ref.read(dataControllerProvider.notifier);
    state = FocusTimerState.fromJson(data.readDeviceValue('focus'));
    pending.value = _readPending(data.readDeviceValue('focus-pending'));
    _logged.addAll(pending.value.map((StudySession session) => session.id));
    WidgetsBinding.instance.addObserver(this);
    if (state.running) _startTicker();
    _checkCompletion();
  }

  final Ref _ref;
  Timer? _ticker;
  final Set<String> _logged = <String>{};

  /// Finished blocks whose save failed (no connection, server refused). They are kept on
  /// this device, per account, until a retry saves them or the student discards them, so
  /// studied time is never silently lost. Same ids on retry: never a duplicate.
  final ValueNotifier<List<StudySession>> pending = ValueNotifier<List<StudySession>>(const <StudySession>[]);

  static List<StudySession> _readPending(String? raw) {
    if (raw == null || raw.isEmpty) return const <StudySession>[];
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! List) return const <StudySession>[];
      return <StudySession>[
        for (final Object? row in decoded)
          if (row is Map) StudySession.fromMap(Map<String, dynamic>.from(row)),
      ];
    } catch (_) {
      return const <StudySession>[];
    }
  }

  void _setPending(List<StudySession> rows) {
    pending.value = List<StudySession>.unmodifiable(rows);
    unawaited(_ref.read(dataControllerProvider.notifier).writeDeviceValue(
          'focus-pending',
          rows.isEmpty ? null : jsonEncode(rows.map((StudySession row) => row.toMap()).toList()),
        ));
  }

  /// Tries every unsaved block again. Returns the minutes saved, or the first error.
  Future<FocusSaveResult> retryPending() async {
    final DataController data = _ref.read(dataControllerProvider.notifier);
    int minutes = 0;
    for (final StudySession session in List<StudySession>.of(pending.value)) {
      try {
        await data.saveSession(session);
        minutes += session.durationMinutes;
        _setPending(pending.value.where((StudySession row) => row.id != session.id).toList());
      } catch (error) {
        return FocusSaveResult(minutes, error: userMessage(error));
      }
    }
    return FocusSaveResult(minutes);
  }

  /// Drops the unsaved blocks on purpose.
  void discardPending() => _setPending(const <StudySession>[]);

  /// Wall clock, replaceable in tests.
  DateTime Function() clock = DateTime.now;

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    pending.dispose();
    _ticker?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Time is measured from timestamps, so stopping the ticker in the background cannot
    // distort the block; it only avoids needless wakeups.
    if (state == AppLifecycleState.paused) {
      _ticker?.cancel();
      _ticker = null;
    } else if (state == AppLifecycleState.resumed && this.state.running) {
      _startTicker();
      _checkCompletion();
    }
  }

  void _set(FocusTimerState next) {
    state = next;
    unawaited(_ref
        .read(dataControllerProvider.notifier)
        .writeDeviceValue('focus', next.started ? jsonEncodeFocus(next) : null));
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!_checkCompletion()) state = state.copyWith();
    });
  }

  /// Completes the block once its deadline has passed. Returns true when it did.
  bool _checkCompletion() {
    if (!state.running || state.remainingAt(clock()) > 0) return false;
    _ticker?.cancel();
    _ticker = null;
    final FocusTimerState snapshot = state;
    _set(snapshot.cleared(finished: true));
    unawaited(_save(snapshot, completed: true));
    return true;
  }

  void start() {
    if (state.running) return;
    _set(state.start(clock(), newId));
    _startTicker();
  }

  void pause() {
    if (!state.running) return;
    if (_checkCompletion()) return;
    _ticker?.cancel();
    _ticker = null;
    _set(state.pause(clock()));
  }

  /// Ends the open block. `save: false` discards it. Idempotent per block.
  Future<FocusSaveResult> end({required bool save}) async {
    if (_checkCompletion()) return const FocusSaveResult(0);
    _ticker?.cancel();
    _ticker = null;
    final FocusTimerState snapshot = state;
    _set(snapshot.cleared());
    if (!save) {
      if (snapshot.blockId != null) _logged.add(snapshot.blockId!);
      return const FocusSaveResult(0);
    }
    return _save(snapshot, completed: false);
  }

  Future<FocusSaveResult> _save(FocusTimerState snapshot, {required bool completed}) async {
    final String? id = snapshot.blockId;
    if (id == null || _logged.contains(id)) return const FocusSaveResult(0);
    final DataController data = _ref.read(dataControllerProvider.notifier);
    final StudySession? session = buildFocusSession(
      snapshot,
      completed: completed,
      now: clock(),
      userId: data.state.data.userId,
    );
    if (session == null) return const FocusSaveResult(0);
    _logged.add(id);
    try {
      await data.saveSession(session);
      return FocusSaveResult(session.durationMinutes);
    } catch (error) {
      // The block is already cleared from the timer: keep it for a retry (same id, so
      // still no duplicate) instead of losing the studied time.
      _setPending(<StudySession>[...pending.value.where((StudySession row) => row.id != session.id), session]);
      return FocusSaveResult(0, error: '${userMessage(error)} Your block is kept on this phone; retry from Focus.');
    }
  }

  void setLength(int minutes) {
    if (state.started) return;
    _set(state.copyWith(totalSeconds: minutes * 60, finished: false));
  }

  void setActivity(String activity) => _set(state.copyWith(activity: activity));

  void setSubject(String? subject) => _set(subject == null
      ? state.copyWith(clearSubject: true)
      : state.copyWith(subject: subject));

  void setChapter(String? chapterId) => _set(chapterId == null
      ? state.copyWith(clearChapter: true)
      : state.copyWith(chapterId: chapterId));
}

final StateNotifierProvider<FocusController, FocusTimerState> focusControllerProvider =
    StateNotifierProvider<FocusController, FocusTimerState>((Ref ref) => FocusController(ref));
