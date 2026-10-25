import 'dart:convert';

import '../core/errors.dart';
import '../data/app_data.dart';
import '../data/app_data_codec.dart';
import '../data/models.dart';

/// Backup payloads. The JSON shape is the same one the local cache uses, so a file
/// exported here can be imported by the app *and* inspected by the website's backup page
/// (which reads table-name keys and rewrites the owner column on import).
const int backupFormatVersion = 2;

Map<String, dynamic> buildBackupPayload(AppData data, {String? exportedAt}) {
  final Map<String, dynamic> payload = AppDataCodec.toJson(data);
  payload['app'] = 'Stracker by DYPOL LABS';
  payload['exported_at'] = exportedAt ?? isoNow();
  payload['format'] = 'stracker-json';
  return payload;
}

String encodeBackup(AppData data) => const JsonEncoder.withIndent('  ').convert(buildBackupPayload(data));

/// Backup key -> table. The app writes table names; the website writes camelCase
/// collection names (`revisions`, `tasks`, `practiceSessions`...). Both import here.
const Map<String, String> backupTableAliases = <String, String>{
  'chapters': 'chapters',
  'chapter_revisions': 'chapter_revisions',
  'revisions': 'chapter_revisions',
  'tests': 'tests',
  'test_subject_scores': 'test_subject_scores',
  'testSubjectScores': 'test_subject_scores',
  'test_chapter_links': 'test_chapter_links',
  'testChapterLinks': 'test_chapter_links',
  'mistakes': 'mistakes',
  'daily_tasks': 'daily_tasks',
  'tasks': 'daily_tasks',
  'weekly_goals': 'weekly_goals',
  'goals': 'weekly_goals',
  'study_sessions': 'study_sessions',
  'sessions': 'study_sessions',
  'practice_sessions': 'practice_sessions',
  'practiceSessions': 'practice_sessions',
  'practice': 'practice_sessions',
  'pyq_records': 'pyq_records',
  'pyqRecords': 'pyq_records',
  'pyqs': 'pyq_records',
  'chapter_stages': 'chapter_stages',
  'chapterStages': 'chapter_stages',
  'stages': 'chapter_stages',
  'backlog_items': 'backlog_items',
  'backlogItems': 'backlog_items',
  'backlog': 'backlog_items',
  'study_cards': 'study_cards',
  'studyCards': 'study_cards',
  'cards': 'study_cards',
  'test_error_logs': 'test_error_logs',
  'testErrorLogs': 'test_error_logs',
  'errorLogs': 'test_error_logs',
  'test_time_entries': 'test_time_entries',
  'testTimeEntries': 'test_time_entries',
  'timeEntries': 'test_time_entries',
  'user_exam_tracks': 'user_exam_tracks',
  'examTracks': 'user_exam_tracks',
};

/// Rewrites any backup (app or website) to the app's own shape: table-name row lists plus
/// `settings` / `profile` objects. A table-name key wins over its alias.
Map<String, dynamic> normalizeBackup(Map<String, dynamic> payload) {
  final Map<String, dynamic> out = <String, dynamic>{};
  Object? single(Object? value) => value is List ? (value.isEmpty ? null : value.first) : value;
  final Object? settings = payload['settings'] ?? single(payload['app_settings']);
  if (settings is Map) out['settings'] = settings;
  final Object? profile = payload['profile'] ?? single(payload['profiles']);
  if (profile is Map) out['profile'] = profile;
  for (final MapEntry<String, dynamic> entry in payload.entries) {
    final String? table = backupTableAliases[entry.key];
    if (table == null || entry.value is! List) continue;
    if (entry.key != table && payload[table] is List) continue;
    out[table] = entry.value;
  }
  return out;
}

/// Rows per table, used for the import preview. Unknown keys are ignored, exactly like
/// the website's preview.
Map<String, int> backupCounts(Map<String, dynamic> payload) {
  final Map<String, dynamic> normalized = normalizeBackup(payload);
  final Map<String, int> counts = <String, int>{};
  for (final String table in backupTableAliases.values.toSet()) {
    final Object? rows = normalized[table];
    if (rows is List && rows.isNotEmpty) counts[table] = rows.length;
  }
  return counts;
}

int backupRowTotal(Map<String, dynamic> payload) =>
    backupCounts(payload).values.fold<int>(0, (int sum, int value) => sum + value);

/// Parses a pasted or restored file. Throws an [AppFailure] with a readable message so the
/// UI never shows a raw FormatException.
Map<String, dynamic> parseBackupText(String raw) {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty) throw const AppFailure('That file is empty.');
  Object? decoded;
  try {
    decoded = jsonDecode(trimmed);
  } on FormatException {
    throw const AppFailure('That is not valid JSON. Export a backup from Stracker and try again.');
  }
  if (decoded is! Map) {
    throw const AppFailure('A Stracker backup is a JSON object of tables, not a list.');
  }
  final Map<String, dynamic> payload = Map<String, dynamic>.from(decoded);
  if (backupCounts(payload).isEmpty) {
    throw const AppFailure('No known tables were found in that file.');
  }
  final Object? version = payload['version'];
  if (version is int && version > backupFormatVersion) {
    throw const AppFailure(
      'That backup was written by a newer version of Stracker. Update the app before importing.',
    );
  }
  return payload;
}

/// CSV exports. One file per table keeps the columns obvious when opened in a spreadsheet.
Map<String, String> backupCsvs(AppData data) {
  String escape(Object? value) {
    final String text = value?.toString() ?? '';
    if (text.contains(',') || text.contains('"') || text.contains('\n')) {
      return '"${text.replaceAll('"', '""')}"';
    }
    return text;
  }

  String table(List<String> columns, List<Map<String, dynamic>> rows) => <String>[
        columns.join(','),
        for (final Map<String, dynamic> row in rows)
          columns.map((String column) => escape(row[column])).join(','),
      ].join('\n');

  return <String, String>{
    'chapters': table(
      <String>['id', 'subject', 'name', 'status', 'priority', 'importance', 'position', 'completed_on'],
      <Map<String, dynamic>>[for (final Chapter row in data.chapters) row.toMap()],
    ),
    'tests': table(
      <String>['id', 'title', 'test_date', 'test_type', 'subject', 'chapter_id', 'marks_obtained', 'total_marks'],
      <Map<String, dynamic>>[for (final TestRecord row in data.tests) row.toMap()],
    ),
    'practice': table(
      <String>['id', 'chapter_id', 'practice_date', 'attempted', 'correct', 'incorrect', 'skipped', 'time_minutes', 'source'],
      <Map<String, dynamic>>[for (final PracticeSession row in data.practiceSessions) row.toMap()],
    ),
    'mistakes': table(
      <String>['id', 'chapter_id', 'mistake_type', 'question_note', 'solution_note', 'retry_status'],
      <Map<String, dynamic>>[for (final Mistake row in data.mistakes) row.toMap()],
    ),
    'revisions': table(
      <String>['id', 'chapter_id', 'revision_number', 'due_on', 'completed_at'],
      <Map<String, dynamic>>[for (final Revision row in data.revisions) row.toMap()],
    ),
    'study_sessions': table(
      <String>['id', 'started_at', 'ended_at', 'duration_minutes', 'activity', 'subject', 'chapter_id'],
      <Map<String, dynamic>>[for (final StudySession row in data.sessions) row.toMap()],
    ),
  };
}
