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

/// Counts per table, used for the import preview. Unknown keys are ignored, exactly like
/// the website's preview.
Map<String, int> backupCounts(Map<String, dynamic> payload) {
  const List<String> keys = <String>[
    'chapters',
    'revisions',
    'tests',
    'testSubjectScores',
    'testChapterLinks',
    'mistakes',
    'tasks',
    'goals',
    'sessions',
    'practice',
    'pyqs',
    'stages',
    'backlog',
    'cards',
    'errorLogs',
    'timeEntries',
    'examTracks',
    'chapter_revisions',
    'test_subject_scores',
    'daily_tasks',
    'practice_sessions',
    'pyq_records',
    'chapter_stages',
    'backlog_items',
    'study_cards',
    'test_error_logs',
    'test_time_entries',
    'user_exam_tracks',
  ];
  final Map<String, int> counts = <String, int>{};
  for (final String key in keys) {
    final Object? rows = payload[key];
    if (rows is List && rows.isNotEmpty) counts[key] = rows.length;
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
      <String>['id', 'chapter_id', 'practice_date', 'attempted', 'correct', 'incorrect', 'time_minutes', 'source'],
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
