import 'dart:convert';

import 'app_data.dart';
import 'models.dart';

/// JSON encoding for the whole notebook. Used for the offline read cache and for the
/// user's own backup files. Every row is written with its table column names, so a file
/// produced here can be restored on the website as well.
class AppDataCodec {
  const AppDataCodec._();

  static const int formatVersion = 2;

  static Map<String, dynamic> toJson(AppData data) => <String, dynamic>{
        'format': 'stracker-json',
        'version': formatVersion,
        'exported_at': isoNow(),
        'user_id': data.userId,
        'settings': data.settings.toMap(),
        'profile': data.profile?.toMap(),
        'chapters': data.chapters.map((Chapter row) => row.toMap()).toList(),
        'chapter_revisions': data.revisions.map((Revision row) => row.toMap()).toList(),
        'tests': data.tests.map((TestRecord row) => row.toMap()).toList(),
        'test_subject_scores': data.testSubjectScores.map((TestSubjectScore row) => row.toMap()).toList(),
        'test_chapter_links': data.testChapterLinks.map((TestChapterLink row) => row.toMap()).toList(),
        'mistakes': data.mistakes.map((Mistake row) => row.toMap()).toList(),
        'daily_tasks': data.tasks.map((DailyTask row) => row.toMap()).toList(),
        'weekly_goals': data.goals.map((WeeklyGoal row) => row.toMap()).toList(),
        'study_sessions': data.sessions.map((StudySession row) => row.toMap()).toList(),
        'practice_sessions': data.practiceSessions.map((PracticeSession row) => row.toMap()).toList(),
        'pyq_records': data.pyqRecords.map((PyqRecord row) => row.toMap()).toList(),
        'chapter_stages': data.chapterStages.map((ChapterStageRow row) => row.toMap()).toList(),
        'backlog_items': data.backlogItems.map((BacklogItem row) => row.toMap()).toList(),
        'study_cards': data.studyCards.map((StudyCard row) => row.toMap()).toList(),
        'test_error_logs': data.errorLogs.map((TestErrorLog row) => row.toMap()).toList(),
        'test_time_entries': data.timeEntries.map((TestTimeEntry row) => row.toMap()).toList(),
        'user_exam_tracks': data.examTracks.map((UserExamTrack row) => row.toMap()).toList(),
        'exam_catalog': <Map<String, dynamic>>[
          for (final ExamCatalogEntry entry in data.examCatalog)
            <String, dynamic>{
              'id': entry.id,
              'name': entry.name,
              'category': entry.category,
              'years': entry.years,
              'sessions': entry.sessions,
              'boards': entry.boards,
              'boards_addon': entry.boardsAddon,
              'subjects': entry.subjects,
              'session_label': entry.sessionLabel,
              'sort_order': entry.sortOrder,
              if (entry.markingScheme != null) 'marking_scheme': entry.markingScheme,
            },
        ],
      };

  static String encode(AppData data) => jsonEncode(toJson(data));

  /// Tolerant reader: a cache written by an older build must still open. Rows that cannot
  /// be decoded are skipped individually instead of losing the whole notebook.
  static AppData? decode(String raw, String userId) {
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return null;
    }
    if (decoded is! Map) return null;
    final Map<String, dynamic> map = Map<String, dynamic>.from(decoded);
    final Object? storedUser = map['user_id'] ?? map['userId'];
    if (storedUser != null && storedUser != userId) return null;

    List<T> rows<T>(List<String> keys, T Function(Map<String, dynamic>) read) {
      for (final String key in keys) {
        final Object? value = map[key];
        if (value is List) {
          final List<T> result = <T>[];
          for (final Object? row in value) {
            if (row is! Map) continue;
            try {
              result.add(read(Map<String, dynamic>.from(row)));
            } catch (_) {
              // Skip a malformed row rather than discarding the notebook.
            }
          }
          return result;
        }
      }
      return <T>[];
    }

    try {
      return AppData(
        userId: userId,
        settings: map['settings'] is Map
            ? AppSettings.fromMap(Map<String, dynamic>.from(map['settings'] as Map), userId)
            : AppSettings.defaults(userId),
        profile: map['profile'] is Map ? Profile.fromMap(Map<String, dynamic>.from(map['profile'] as Map)) : null,
        chapters: rows<Chapter>(<String>['chapters'], Chapter.fromMap),
        revisions: rows<Revision>(<String>['chapter_revisions', 'revisions'], Revision.fromMap),
        tests: rows<TestRecord>(<String>['tests'], TestRecord.fromMap),
        testSubjectScores: rows<TestSubjectScore>(<String>['test_subject_scores'], TestSubjectScore.fromMap),
        testChapterLinks: rows<TestChapterLink>(<String>['test_chapter_links'], TestChapterLink.fromMap),
        mistakes: rows<Mistake>(<String>['mistakes'], Mistake.fromMap),
        tasks: rows<DailyTask>(<String>['daily_tasks', 'tasks'], DailyTask.fromMap),
        goals: rows<WeeklyGoal>(<String>['weekly_goals', 'goals'], WeeklyGoal.fromMap),
        sessions: rows<StudySession>(<String>['study_sessions', 'sessions'], StudySession.fromMap),
        practiceSessions: rows<PracticeSession>(<String>['practice_sessions', 'practice'], PracticeSession.fromMap),
        pyqRecords: rows<PyqRecord>(<String>['pyq_records', 'pyqs'], PyqRecord.fromMap),
        chapterStages: rows<ChapterStageRow>(<String>['chapter_stages', 'stages'], ChapterStageRow.fromMap),
        backlogItems: rows<BacklogItem>(<String>['backlog_items', 'backlog'], BacklogItem.fromMap),
        studyCards: rows<StudyCard>(<String>['study_cards', 'cards'], StudyCard.fromMap),
        errorLogs: rows<TestErrorLog>(<String>['test_error_logs', 'errorLogs'], TestErrorLog.fromMap),
        timeEntries: rows<TestTimeEntry>(<String>['test_time_entries', 'timeEntries'], TestTimeEntry.fromMap),
        examTracks: rows<UserExamTrack>(<String>['user_exam_tracks', 'examTracks'], UserExamTrack.fromMap),
        examCatalog: rows<ExamCatalogEntry>(<String>['exam_catalog'], ExamCatalogEntry.fromMap),
      );
    } catch (_) {
      return null;
    }
  }
}
