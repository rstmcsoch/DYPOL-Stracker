import 'dart:convert';
import 'dart:math' as math;

import '../data/models.dart';

/// Pure focus-timer state shared by the Focus page and the Home indicator.
///
/// Time is measured from wall-clock timestamps: every paused segment is folded into
/// [accumulatedSeconds] and the running segment is measured from [segmentStartedAt],
/// so a throttled ticker or a backgrounded app never distorts the recorded duration.
/// Matches the website's `src/lib/focus-timer.ts` semantics: a naturally finished
/// block is `completed`, an ended-early block the student chooses to save is
/// `interrupted` (the only other value the `study_sessions` schema accepts).
class FocusTimerState {
  const FocusTimerState({
    this.totalSeconds = 25 * 60,
    this.accumulatedSeconds = 0,
    this.segmentStartedAt,
    this.blockStartedAt,
    this.blockId,
    this.activity = 'Practice',
    this.subject,
    this.chapterId,
    this.finished = false,
  });

  static const int maxSeconds = 180 * 60;

  final int totalSeconds;
  final int accumulatedSeconds;
  final DateTime? segmentStartedAt;
  final DateTime? blockStartedAt;
  final String? blockId;
  final String activity;
  final String? subject;
  final String? chapterId;
  final bool finished;

  bool get running => segmentStartedAt != null;
  bool get started => blockId != null;

  /// Real studied seconds: paused segments plus the running one, capped at the block length.
  int elapsedAt(DateTime now) {
    final DateTime? segment = segmentStartedAt;
    final int tail = segment == null ? 0 : math.max(0, now.difference(segment).inSeconds);
    return math.min(totalSeconds, math.max(0, accumulatedSeconds + tail));
  }

  int remainingAt(DateTime now) => math.max(0, totalSeconds - elapsedAt(now));

  /// True when the block holds studied time that has not been saved yet.
  bool hasUnsavedAt(DateTime now) => started && !finished && elapsedAt(now) > 0;

  FocusTimerState copyWith({
    int? totalSeconds,
    int? accumulatedSeconds,
    DateTime? segmentStartedAt,
    bool clearSegment = false,
    DateTime? blockStartedAt,
    String? blockId,
    bool clearBlock = false,
    String? activity,
    String? subject,
    bool clearSubject = false,
    String? chapterId,
    bool clearChapter = false,
    bool? finished,
  }) =>
      FocusTimerState(
        totalSeconds: totalSeconds ?? this.totalSeconds,
        accumulatedSeconds: accumulatedSeconds ?? this.accumulatedSeconds,
        segmentStartedAt: clearSegment ? null : (segmentStartedAt ?? this.segmentStartedAt),
        blockStartedAt: clearBlock ? null : (blockStartedAt ?? this.blockStartedAt),
        blockId: clearBlock ? null : (blockId ?? this.blockId),
        activity: activity ?? this.activity,
        subject: clearSubject ? null : (subject ?? this.subject),
        chapterId: clearChapter ? null : (chapterId ?? this.chapterId),
        finished: finished ?? this.finished,
      );

  /// Starts a new block or resumes a paused one without losing earlier segments.
  FocusTimerState start(DateTime now, String Function() idFactory) {
    if (running) return this;
    final bool fresh = !started || finished;
    return FocusTimerState(
      totalSeconds: totalSeconds,
      accumulatedSeconds: fresh ? 0 : accumulatedSeconds,
      segmentStartedAt: now,
      blockStartedAt: fresh ? now : blockStartedAt,
      blockId: fresh ? idFactory() : blockId,
      activity: activity,
      subject: subject,
      chapterId: chapterId,
    );
  }

  /// Folds the running segment into the accumulated time; the block stays open.
  FocusTimerState pause(DateTime now) {
    if (!running) return this;
    return copyWith(accumulatedSeconds: elapsedAt(now), clearSegment: true);
  }

  /// An idle block of the same length that keeps the chosen subject, chapter and activity.
  FocusTimerState cleared({bool finished = false}) => FocusTimerState(
        totalSeconds: totalSeconds,
        activity: activity,
        subject: subject,
        chapterId: chapterId,
        finished: finished,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'total': totalSeconds,
        'accumulated': accumulatedSeconds,
        'segment': segmentStartedAt?.toUtc().toIso8601String(),
        'block_started': blockStartedAt?.toUtc().toIso8601String(),
        'block_id': blockId,
        'activity': activity,
        'subject': subject,
        'chapter_id': chapterId,
      };

  /// Restores a saved timer, rejecting anything malformed instead of inventing time.
  static FocusTimerState fromJson(String? raw) {
    if (raw == null || raw.isEmpty) return const FocusTimerState();
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return const FocusTimerState();
      int bounded(Object? value, int fallback, int min) =>
          value is int && value >= min && value <= maxSeconds ? value : fallback;
      DateTime? time(Object? value) => value is String ? DateTime.tryParse(value) : null;
      const List<String> activities = <String>['Lecture', 'Practice', 'Revision', 'Mock/Test', 'PYQ practice'];
      final String? id = decoded['block_id'] is String ? decoded['block_id'] as String : null;
      final int total = bounded(decoded['total'], 25 * 60, 60);
      return FocusTimerState(
        totalSeconds: total,
        accumulatedSeconds: id == null ? 0 : math.min(total, bounded(decoded['accumulated'], 0, 0)),
        segmentStartedAt: id == null ? null : time(decoded['segment']),
        blockStartedAt: id == null ? null : time(decoded['block_started']),
        blockId: id,
        activity: activities.contains(decoded['activity']) ? decoded['activity'] as String : 'Practice',
        subject: decoded['subject'] is String ? decoded['subject'] as String : null,
        chapterId: decoded['chapter_id'] is String ? decoded['chapter_id'] as String : null,
      );
    } catch (_) {
      return const FocusTimerState();
    }
  }
}

/// Whole minutes a save records (the integer-minute `study_sessions` format).
int loggableMinutes(int seconds) => math.max(0, math.min(180, (seconds / 60).round()));

/// Live counter text: `mm:ss`, or `h:mm:ss` past an hour.
String focusClock(int totalSeconds) {
  final int seconds = math.max(0, totalSeconds);
  final int h = seconds ~/ 3600;
  final String mm = ((seconds % 3600) ~/ 60).toString().padLeft(2, '0');
  final String ss = (seconds % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:$mm:$ss' : '$mm:$ss';
}

/// The `study_sessions` row for this block, or null when nothing is worth recording
/// (under a minute, or no block). The row id is the block id, so a repeated save of one
/// block upserts the same record instead of duplicating study time.
StudySession? buildFocusSession(
  FocusTimerState state, {
  required bool completed,
  required DateTime now,
  required String userId,
}) {
  final String? id = state.blockId;
  if (id == null) return null;
  final int elapsed = completed ? state.totalSeconds : state.elapsedAt(now);
  final int minutes = loggableMinutes(elapsed);
  if (minutes < 1) return null;
  final DateTime started = state.blockStartedAt ?? now.subtract(Duration(seconds: elapsed));
  final DateTime? segment = state.segmentStartedAt;
  final DateTime deadline = segment == null
      ? now
      : segment.add(Duration(seconds: state.totalSeconds - state.accumulatedSeconds));
  final DateTime ended = deadline.isBefore(now) ? deadline : now;
  final String endIso = ended.toUtc().toIso8601String();
  return StudySession(
    id: id,
    userId: userId,
    subject: state.subject,
    chapterId: state.chapterId,
    startedAt: started.toUtc().toIso8601String(),
    endedAt: endIso,
    durationMinutes: minutes,
    completionState: completed ? 'completed' : 'interrupted',
    mode: 'Pomodoro',
    activity: state.activity,
    createdAt: endIso,
    updatedAt: endIso,
  );
}

/// Recorded study sessions that count as study time on every screen: completed blocks
/// and saved partial (`interrupted`) blocks. Breaks never count.
bool countsAsStudyTime(StudySession session) =>
    session.mode != 'Short Break' &&
    session.mode != 'Long Break' &&
    (session.completionState == 'completed' || session.completionState == 'interrupted');

/// Device-storage encoding for [FocusTimerState].
String jsonEncodeFocus(FocusTimerState state) => jsonEncode(state.toJson());
