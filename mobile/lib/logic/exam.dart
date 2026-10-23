import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';

/// Exam tracks and Exam Mode, ported from src/lib/jee/exam.ts.
///
/// Tracks share one syllabus; only dates and targets differ. Main Session 1 and
/// Advanced reuse the dates already stored in `app_settings`; Session 2 and Boards
/// use `user_exam_tracks.exam_date`. No official date is assumed anywhere.
const List<String> trackIds = <String>['main1', 'main2', 'advanced', 'boards'];

const Map<String, String> trackLabelJee = <String, String>{
  'main1': 'JEE Main — Session 1',
  'main2': 'JEE Main — Session 2',
  'advanced': 'JEE Advanced',
  'boards': 'Boards',
};

const Map<String, String?> trackPyqExam = <String, String?>{
  'main1': 'Main',
  'main2': 'Main',
  'advanced': 'Advanced',
  'boards': null,
};

const int examModeWindowDays = 30;
const double examModeBoost = 1.35;

bool isJeeSettings(AppSettings settings) => isJeeExam(settings.examId);

String chosenExamTitle(AppData data) {
  final String name = examNameFor(data, data.settings.examId);
  final int? year = data.settings.examYear;
  return year == null ? name : '$name $year';
}

Map<String, String> trackLabels(AppData data) {
  if (isJeeSettings(data.settings)) return trackLabelJee;
  final String title = chosenExamTitle(data);
  return <String, String>{
    'main1': title,
    'main2': title,
    'advanced': title,
    'boards': 'Class 12 boards',
  };
}

List<String> availableTracks(AppSettings settings) {
  if (isJeeSettings(settings)) return trackIds;
  return settings.boardsAddon
      ? <String>['main1', 'boards']
      : <String>['main1'];
}

String effectiveTrack(AppSettings settings) =>
    availableTracks(settings).contains(settings.activeTrack) ? settings.activeTrack : 'main1';

String? trackDate(AppData data, String track) {
  switch (track) {
    case 'main1':
      return data.settings.mainExamDate;
    case 'advanced':
      return data.settings.advancedExamDate;
    default:
      for (final UserExamTrack row in data.examTracks) {
        if (row.track == track) return row.examDate;
      }
      return null;
  }
}

UserExamTrack trackConfig(AppData data, String track) {
  for (final UserExamTrack row in data.examTracks) {
    if (row.track == track) return row;
  }
  final String now = isoNow();
  return UserExamTrack(
    id: 'track-$track',
    userId: data.userId,
    track: track,
    label: trackLabelJee[track] ?? track,
    createdAt: now,
    updatedAt: now,
  );
}

/// Exam Mode is on automatically inside the 30-day window of the active track, or by
/// hand. Auto mode needs a date, so a blank date never turns it on.
bool currentExamMode(AppData data, String today) {
  final AppSettings settings = data.settings;
  if (settings.examMode == 'off') return false;
  if (settings.examMode == 'on') return true;
  final String? date = trackDate(data, effectiveTrack(settings));
  if (date == null || date.isEmpty) return false;
  final int delta = daysBetween(today, date);
  return delta >= 0 && delta <= examModeWindowDays;
}

String examModeLabel(AppData data, String today) {
  if (!currentExamMode(data, today)) return 'Off';
  final String? date = trackDate(data, effectiveTrack(data.settings));
  final String track = trackLabels(data)[effectiveTrack(data.settings)] ?? 'Exam';
  if (date == null) return 'On';
  return 'On · $track ${countdownLabel(date)}';
}
