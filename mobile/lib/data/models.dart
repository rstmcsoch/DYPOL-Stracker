// Typed models for the existing Stracker Postgres schema.
//
import 'dart:math';

// Column names match supabase/migrations/*.sql exactly; the JSON maps produced by
// [toMap] are the same rows the web client writes, so records created in the app are
// identical to records created on the website.

/// Postgres `date` strings are `yyyy-MM-dd`; timestamps are ISO-8601 UTC.
String isoNow() => DateTime.now().toUtc().toIso8601String();

String _str(Object? value, [String fallback = '']) =>
    value is String ? value : (value == null ? fallback : value.toString());

String? _strOrNull(Object? value) {
  if (value == null) return null;
  final String text = value.toString();
  return text.isEmpty ? null : text;
}

double? _numOrNull(Object? value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}

int _int(Object? value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse(value.toString()) ?? fallback;
}

int? _intOrNull(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse(value.toString());
}

bool _bool(Object? value, [bool fallback = false]) => value is bool ? value : fallback;

List<String> _stringList(Object? value) {
  if (value is List) return value.map((item) => item.toString()).toList(growable: false);
  return const <String>[];
}

List<int> _intList(Object? value) {
  if (value is List) {
    return value.map((item) => _int(item)).where((item) => item > 0).toList(growable: false);
  }
  return const <int>[];
}

/// Random RFC-4122 v4 id, so app-created rows look exactly like web-created ids.
String newId() {
  final Random random = Random.secure();
  final List<int> bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final List<String> hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).toList();
  return '${hex.sublist(0, 4).join()}-${hex.sublist(4, 6).join()}-'
      '${hex.sublist(6, 8).join()}-${hex.sublist(8, 10).join()}-${hex.sublist(10, 16).join()}';
}

/* ------------------------------------------------------------------ */
/* Profile and settings                                                */
/* ------------------------------------------------------------------ */

class Profile {
  const Profile({
    required this.id,
    required this.userId,
    this.displayName = '',
    this.email = '',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String displayName;
  final String email;
  final String createdAt;
  final String updatedAt;

  factory Profile.fromMap(Map<String, dynamic> raw) => Profile(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        displayName: _str(raw['display_name']),
        email: _str(raw['email']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'display_name': displayName,
        'email': email,
      };

  Profile copyWith({String? displayName, String? email}) => Profile(
        id: id,
        userId: userId,
        displayName: displayName ?? this.displayName,
        email: email ?? this.email,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );
}

/// `app_settings` row. Defaults mirror [defaultSettings] in src/lib/defaults.ts.
class AppSettings {
  const AppSettings({
    required this.id,
    required this.userId,
    this.ownerName = '',
    this.mainExamDate,
    this.advancedExamDate,
    this.targetScore = 240,
    this.theme = 'light',
    this.interfaceFont = 'lexend',
    this.colorTheme = 'default',
    this.weakThreshold = 60,
    this.strongThreshold = 80,
    this.droppingThreshold = 10,
    this.revisionGaps = const <int>[1, 7, 30],
    this.dailyStudyGoalMinutes = 360,
    this.lastBackupAt,
    this.soundEnabled = false,
    this.weightHigh = 2,
    this.weightMedium = 1,
    this.weightLow = 0.5,
    this.pyqFromYear = 2019,
    this.pyqToYear = 2026,
    this.activeTrack = 'main1',
    this.examMode = 'auto',
    this.remindersEnabled = false,
    this.reminderTime = '08:00',
    this.reminderTypes = const <String>['revision', 'backlog'],
    this.examId,
    this.examYear,
    this.examSession,
    this.examBoard,
    this.boardsAddon = false,
    this.onboardingCompleted = false,
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String ownerName;
  final String? mainExamDate;
  final String? advancedExamDate;
  final double targetScore;
  final String theme;
  final String interfaceFont;
  final String colorTheme;
  final double weakThreshold;
  final double strongThreshold;
  final double droppingThreshold;
  final List<int> revisionGaps;
  final int dailyStudyGoalMinutes;
  final String? lastBackupAt;
  final bool soundEnabled;
  final double weightHigh;
  final double weightMedium;
  final double weightLow;
  final int pyqFromYear;
  final int pyqToYear;
  final String activeTrack;
  final String examMode;
  final bool remindersEnabled;
  final String reminderTime;
  final List<String> reminderTypes;
  final String? examId;
  final int? examYear;
  final String? examSession;
  final String? examBoard;
  final bool boardsAddon;
  final bool onboardingCompleted;
  final String createdAt;
  final String updatedAt;

  static AppSettings defaults(String userId, {String ownerName = ''}) => AppSettings(
        id: userId,
        userId: userId,
        ownerName: ownerName,
        createdAt: isoNow(),
        updatedAt: isoNow(),
      );

  /// Tolerant reader: rows written before the JEE extensions keep loading, exactly
  /// like `normalizeSettings` on the web (nothing is silently wiped).
  factory AppSettings.fromMap(Map<String, dynamic> raw, String userId) {
    final AppSettings fallback = AppSettings.defaults(userId);
    return AppSettings(
      id: _str(raw['id'], userId),
      userId: _str(raw['user_id'], userId),
      ownerName: _str(raw['owner_name']),
      mainExamDate: _strOrNull(raw['main_exam_date']),
      advancedExamDate: _strOrNull(raw['advanced_exam_date']),
      targetScore: _numOrNull(raw['target_score']) ?? fallback.targetScore,
      theme: _str(raw['theme'], 'light'),
      // The database stores Lexend as 'default' (web READING_FONTS); unknown values fall back to it.
      interfaceFont: switch (_str(raw['interface_font'], 'default')) {
        'poppins' => 'poppins',
        'sora' => 'sora',
        'open-sans' => 'open-sans',
        _ => 'lexend',
      },
      colorTheme: _str(raw['color_theme'], 'default'),
      weakThreshold: _numOrNull(raw['weak_threshold']) ?? 60,
      strongThreshold: _numOrNull(raw['strong_threshold']) ?? 80,
      droppingThreshold: _numOrNull(raw['dropping_threshold']) ?? 10,
      revisionGaps: _intList(raw['revision_gaps']).isEmpty ? fallback.revisionGaps : _intList(raw['revision_gaps']),
      dailyStudyGoalMinutes: _int(raw['daily_study_goal_minutes'], 360),
      lastBackupAt: _strOrNull(raw['last_backup_at']),
      soundEnabled: _bool(raw['sound_enabled']),
      weightHigh: _numOrNull(raw['weight_high']) ?? 2,
      weightMedium: _numOrNull(raw['weight_medium']) ?? 1,
      weightLow: _numOrNull(raw['weight_low']) ?? 0.5,
      pyqFromYear: _int(raw['pyq_from_year'], 2019),
      pyqToYear: _int(raw['pyq_to_year'], 2026),
      activeTrack: _str(raw['active_track'], 'main1'),
      examMode: _str(raw['exam_mode'], 'auto'),
      remindersEnabled: _bool(raw['reminders_enabled']),
      reminderTime: _str(raw['reminder_time'], '08:00'),
      reminderTypes:
          _stringList(raw['reminder_types']).isEmpty ? fallback.reminderTypes : _stringList(raw['reminder_types']),
      examId: _strOrNull(raw['exam_id']),
      examYear: _intOrNull(raw['exam_year']),
      examSession: _strOrNull(raw['exam_session']),
      examBoard: _strOrNull(raw['exam_board']),
      boardsAddon: _bool(raw['boards_addon']),
      onboardingCompleted: _bool(raw['onboarding_completed']),
      createdAt: _str(raw['created_at']),
      updatedAt: _str(raw['updated_at']),
    );
  }

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'owner_name': ownerName,
        'main_exam_date': mainExamDate,
        'advanced_exam_date': advancedExamDate,
        'target_score': targetScore,
        'theme': theme,
        'interface_font': interfaceFont == 'lexend' ? 'default' : interfaceFont,
        'color_theme': colorTheme,
        'weak_threshold': weakThreshold,
        'strong_threshold': strongThreshold,
        'dropping_threshold': droppingThreshold,
        'revision_gaps': revisionGaps,
        'daily_study_goal_minutes': dailyStudyGoalMinutes,
        'last_backup_at': lastBackupAt,
        'sound_enabled': soundEnabled,
        'weight_high': weightHigh,
        'weight_medium': weightMedium,
        'weight_low': weightLow,
        'pyq_from_year': pyqFromYear,
        'pyq_to_year': pyqToYear,
        'active_track': activeTrack,
        'exam_mode': examMode,
        'reminders_enabled': remindersEnabled,
        'reminder_time': reminderTime,
        'reminder_types': reminderTypes,
        'exam_id': examId,
        'exam_year': examYear,
        'exam_session': examSession,
        'exam_board': examBoard,
        'boards_addon': boardsAddon,
        'onboarding_completed': onboardingCompleted,
      };

  /// Stamps `updated_at` with the current UTC time. Every settings write goes through this
  /// so the website and the app agree on when the change happened.
  AppSettings copyWithUpdated() => copyWith(updatedAt: isoNow());

  AppSettings copyWith({
    String? updatedAt,
    String? ownerName,
    Object? mainExamDate = _sentinel,
    Object? advancedExamDate = _sentinel,
    double? targetScore,
    String? theme,
    String? interfaceFont,
    String? colorTheme,
    double? weakThreshold,
    double? strongThreshold,
    double? droppingThreshold,
    List<int>? revisionGaps,
    int? dailyStudyGoalMinutes,
    String? lastBackupAt,
    bool? soundEnabled,
    double? weightHigh,
    double? weightMedium,
    double? weightLow,
    int? pyqFromYear,
    int? pyqToYear,
    String? activeTrack,
    String? examMode,
    bool? remindersEnabled,
    String? reminderTime,
    List<String>? reminderTypes,
    Object? examId = _sentinel,
    Object? examYear = _sentinel,
    Object? examSession = _sentinel,
    Object? examBoard = _sentinel,
    bool? boardsAddon,
    bool? onboardingCompleted,
  }) {
    return AppSettings(
      id: id,
      userId: userId,
      ownerName: ownerName ?? this.ownerName,
      mainExamDate: mainExamDate == _sentinel ? this.mainExamDate : mainExamDate as String?,
      advancedExamDate: advancedExamDate == _sentinel ? this.advancedExamDate : advancedExamDate as String?,
      targetScore: targetScore ?? this.targetScore,
      theme: theme ?? this.theme,
      interfaceFont: interfaceFont ?? this.interfaceFont,
      colorTheme: colorTheme ?? this.colorTheme,
      weakThreshold: weakThreshold ?? this.weakThreshold,
      strongThreshold: strongThreshold ?? this.strongThreshold,
      droppingThreshold: droppingThreshold ?? this.droppingThreshold,
      revisionGaps: revisionGaps ?? this.revisionGaps,
      dailyStudyGoalMinutes: dailyStudyGoalMinutes ?? this.dailyStudyGoalMinutes,
      lastBackupAt: lastBackupAt ?? this.lastBackupAt,
      soundEnabled: soundEnabled ?? this.soundEnabled,
      weightHigh: weightHigh ?? this.weightHigh,
      weightMedium: weightMedium ?? this.weightMedium,
      weightLow: weightLow ?? this.weightLow,
      pyqFromYear: pyqFromYear ?? this.pyqFromYear,
      pyqToYear: pyqToYear ?? this.pyqToYear,
      activeTrack: activeTrack ?? this.activeTrack,
      examMode: examMode ?? this.examMode,
      remindersEnabled: remindersEnabled ?? this.remindersEnabled,
      reminderTime: reminderTime ?? this.reminderTime,
      reminderTypes: reminderTypes ?? this.reminderTypes,
      examId: examId == _sentinel ? this.examId : examId as String?,
      examYear: examYear == _sentinel ? this.examYear : examYear as int?,
      examSession: examSession == _sentinel ? this.examSession : examSession as String?,
      examBoard: examBoard == _sentinel ? this.examBoard : examBoard as String?,
      boardsAddon: boardsAddon ?? this.boardsAddon,
      onboardingCompleted: onboardingCompleted ?? this.onboardingCompleted,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}

const Object _sentinel = Object();

/* ------------------------------------------------------------------ */
/* Syllabus                                                            */
/* ------------------------------------------------------------------ */

class Chapter {
  const Chapter({
    required this.id,
    required this.userId,
    required this.subject,
    required this.name,
    this.position = 0,
    this.status = 'Not Started',
    this.priority = 'Medium',
    this.importance = 'medium',
    this.weightage,
    this.notes = '',
    this.formulaNotes = '',
    this.completedOn,
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String subject;
  final String name;
  final int position;
  final String status;
  final String priority;
  final String importance;
  final String? weightage;
  final String notes;
  final String formulaNotes;
  final String? completedOn;
  final String createdAt;
  final String updatedAt;

  bool get isComplete => status == 'Done' || status == 'Revised';

  factory Chapter.fromMap(Map<String, dynamic> raw) => Chapter(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        subject: _str(raw['subject']),
        name: _str(raw['name']),
        position: _int(raw['position']),
        status: _str(raw['status'], 'Not Started'),
        priority: _str(raw['priority'], 'Medium'),
        importance: _str(raw['importance'], 'medium'),
        weightage: _strOrNull(raw['weightage']),
        notes: _str(raw['notes']),
        formulaNotes: _str(raw['formula_notes']),
        completedOn: _strOrNull(raw['completed_on']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'subject': subject,
        'name': name,
        'position': position,
        'status': status,
        'priority': priority,
        'importance': importance,
        'weightage': weightage,
        'notes': notes,
        'formula_notes': formulaNotes,
        'completed_on': completedOn,
      };

  Chapter copyWith({
    String? subject,
    String? name,
    int? position,
    String? status,
    String? priority,
    String? importance,
    Object? weightage = _sentinel,
    String? notes,
    String? formulaNotes,
    Object? completedOn = _sentinel,
  }) =>
      Chapter(
        id: id,
        userId: userId,
        subject: subject ?? this.subject,
        name: name ?? this.name,
        position: position ?? this.position,
        status: status ?? this.status,
        priority: priority ?? this.priority,
        importance: importance ?? this.importance,
        weightage: weightage == _sentinel ? this.weightage : weightage as String?,
        notes: notes ?? this.notes,
        formulaNotes: formulaNotes ?? this.formulaNotes,
        completedOn: completedOn == _sentinel ? this.completedOn : completedOn as String?,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );
}

class Revision {
  const Revision({
    required this.id,
    required this.userId,
    required this.chapterId,
    required this.revisionNumber,
    required this.dueOn,
    this.completedAt,
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String chapterId;
  final int revisionNumber;
  final String dueOn;
  final String? completedAt;
  final String createdAt;
  final String updatedAt;

  bool get isDone => completedAt != null;

  factory Revision.fromMap(Map<String, dynamic> raw) => Revision(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        chapterId: _str(raw['chapter_id']),
        revisionNumber: _int(raw['revision_number'], 1),
        dueOn: _str(raw['due_on']),
        completedAt: _strOrNull(raw['completed_at']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'chapter_id': chapterId,
        'revision_number': revisionNumber,
        'due_on': dueOn,
        'completed_at': completedAt,
      };

  Revision copyWith({String? dueOn, Object? completedAt = _sentinel, int? revisionNumber}) => Revision(
        id: id,
        userId: userId,
        chapterId: chapterId,
        revisionNumber: revisionNumber ?? this.revisionNumber,
        dueOn: dueOn ?? this.dueOn,
        completedAt: completedAt == _sentinel ? this.completedAt : completedAt as String?,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

class TestRecord {
  const TestRecord({
    required this.id,
    required this.userId,
    required this.title,
    required this.testDate,
    required this.testType,
    this.subject,
    this.chapterId,
    this.marksObtained,
    this.totalMarks,
    this.correct,
    this.wrong,
    this.skipped,
    this.totalQuestions,
    this.negativeMarks,
    this.timeMinutes,
    this.notes = '',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String title;
  final String testDate;
  final String testType;
  final String? subject;
  final String? chapterId;
  final double? marksObtained;
  final double? totalMarks;
  final int? correct;
  final int? wrong;
  final int? skipped;

  /// Optional question count; correct + wrong + skipped never exceed it.
  final int? totalQuestions;
  final double? negativeMarks;
  final int? timeMinutes;
  final String notes;
  final String createdAt;
  final String updatedAt;

  double? get percentage {
    final double? obtained = marksObtained;
    final double? total = totalMarks;
    if (obtained == null || total == null || total <= 0) return null;
    return obtained / total * 100;
  }

  factory TestRecord.fromMap(Map<String, dynamic> raw) => TestRecord(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        title: _str(raw['title']),
        testDate: _str(raw['test_date']),
        testType: _str(raw['test_type'], 'Chapter Test'),
        subject: _strOrNull(raw['subject']),
        chapterId: _strOrNull(raw['chapter_id']),
        marksObtained: _numOrNull(raw['marks_obtained']),
        totalMarks: _numOrNull(raw['total_marks']),
        correct: _intOrNull(raw['correct']),
        wrong: _intOrNull(raw['wrong']),
        skipped: _intOrNull(raw['skipped']),
        totalQuestions: _intOrNull(raw['total_questions']),
        negativeMarks: _numOrNull(raw['negative_marks']),
        timeMinutes: _intOrNull(raw['time_minutes']),
        notes: _str(raw['notes']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'title': title,
        'test_date': testDate,
        'test_type': testType,
        'subject': subject,
        'chapter_id': chapterId,
        'marks_obtained': marksObtained,
        'total_marks': totalMarks,
        'correct': correct,
        'wrong': wrong,
        'skipped': skipped,
        'total_questions': totalQuestions,
        'negative_marks': negativeMarks,
        'time_minutes': timeMinutes,
        'notes': notes,
      };
}

class TestSubjectScore {
  const TestSubjectScore({
    required this.id,
    required this.userId,
    required this.testId,
    required this.subject,
    this.marksObtained,
    this.totalMarks,
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String testId;
  final String subject;
  final double? marksObtained;
  final double? totalMarks;
  final String createdAt;
  final String updatedAt;

  factory TestSubjectScore.fromMap(Map<String, dynamic> raw) => TestSubjectScore(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        testId: _str(raw['test_id']),
        subject: _str(raw['subject']),
        marksObtained: _numOrNull(raw['marks_obtained']),
        totalMarks: _numOrNull(raw['total_marks']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'test_id': testId,
        'subject': subject,
        'marks_obtained': marksObtained,
        'total_marks': totalMarks,
      };
}

class TestChapterLink {
  const TestChapterLink({
    required this.id,
    required this.userId,
    required this.testId,
    required this.chapterId,
    this.marksObtained,
    this.totalMarks,
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String testId;
  final String chapterId;
  final double? marksObtained;
  final double? totalMarks;
  final String createdAt;
  final String updatedAt;

  factory TestChapterLink.fromMap(Map<String, dynamic> raw) => TestChapterLink(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        testId: _str(raw['test_id']),
        chapterId: _str(raw['chapter_id']),
        marksObtained: _numOrNull(raw['marks_obtained']),
        totalMarks: _numOrNull(raw['total_marks']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'test_id': testId,
        'chapter_id': chapterId,
        'marks_obtained': marksObtained,
        'total_marks': totalMarks,
      };
}

/* ------------------------------------------------------------------ */
/* Practice (DPP) log                                                  */
/* ------------------------------------------------------------------ */

class PracticeSession {
  const PracticeSession({
    required this.id,
    required this.userId,
    required this.chapterId,
    required this.practiceDate,
    required this.attempted,
    required this.correct,
    required this.incorrect,
    this.skipped = 0,
    this.source = 'Other',
    this.timeMinutes,
    this.notes = '',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String chapterId;
  final String practiceDate;
  final int attempted;
  final int correct;
  final int incorrect;

  /// Questions skipped (not attempted). Separate from attempted/correct/incorrect; 0 for older rows.
  final int skipped;
  final String source;
  final int? timeMinutes;
  final String notes;
  final String createdAt;
  final String updatedAt;

  double? get accuracy => attempted > 0 ? correct / attempted * 100 : null;

  factory PracticeSession.fromMap(Map<String, dynamic> raw) => PracticeSession(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        chapterId: _str(raw['chapter_id']),
        practiceDate: _str(raw['practice_date']),
        attempted: _int(raw['attempted']),
        correct: _int(raw['correct']),
        incorrect: _int(raw['incorrect']),
        skipped: _int(raw['skipped']) < 0 ? 0 : _int(raw['skipped']),
        source: _str(raw['source'], 'Other'),
        timeMinutes: _intOrNull(raw['time_minutes']),
        notes: _str(raw['notes']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'chapter_id': chapterId,
        'practice_date': practiceDate,
        'attempted': attempted,
        'correct': correct,
        'incorrect': incorrect,
        'skipped': skipped,
        'source': source,
        'time_minutes': timeMinutes,
        'notes': notes,
      };
}

/* ------------------------------------------------------------------ */
/* PYQ tracker                                                         */
/* ------------------------------------------------------------------ */

class PyqRecord {
  const PyqRecord({
    required this.id,
    required this.userId,
    required this.chapterId,
    required this.exam,
    required this.year,
    this.status = 'pending',
    this.questionsTotal,
    this.questionsDone,
    this.completedAt,
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String chapterId;
  final String exam;
  final int year;
  final String status;
  final int? questionsTotal;
  final int? questionsDone;
  final String? completedAt;
  final String createdAt;
  final String updatedAt;

  bool get isDone => status == 'done';

  factory PyqRecord.fromMap(Map<String, dynamic> raw) => PyqRecord(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        chapterId: _str(raw['chapter_id']),
        exam: _str(raw['exam'], 'Main'),
        year: _int(raw['year']),
        status: _str(raw['status'], 'pending'),
        questionsTotal: _intOrNull(raw['questions_total']),
        questionsDone: _intOrNull(raw['questions_done']),
        completedAt: _strOrNull(raw['completed_at']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'chapter_id': chapterId,
        'exam': exam,
        'year': year,
        'status': status,
        'questions_total': questionsTotal,
        'questions_done': questionsDone,
        'completed_at': completedAt,
      };
}

/* ------------------------------------------------------------------ */
/* Chapter stages                                                      */
/* ------------------------------------------------------------------ */

const List<String> chapterStageKeys = <String>['theory', 'notes', 'pyqs', 'revised', 'tested'];
const Map<String, String> chapterStageLabels = <String, String>{
  'theory': 'Theory',
  'notes': 'Notes',
  'pyqs': 'PYQs',
  'revised': 'Revised',
  'tested': 'Tested',
};

class ChapterStageRow {
  const ChapterStageRow({
    required this.id,
    required this.userId,
    required this.chapterId,
    required this.stage,
    required this.done,
    this.completedAt,
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String chapterId;
  final String stage;
  final bool done;
  final String? completedAt;
  final String createdAt;
  final String updatedAt;

  factory ChapterStageRow.fromMap(Map<String, dynamic> raw) => ChapterStageRow(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        chapterId: _str(raw['chapter_id']),
        stage: _str(raw['stage'], 'theory'),
        done: _bool(raw['done']),
        completedAt: _strOrNull(raw['completed_at']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'chapter_id': chapterId,
        'stage': stage,
        'done': done,
        'completed_at': completedAt,
      };
}

/* ------------------------------------------------------------------ */
/* Backlog                                                             */
/* ------------------------------------------------------------------ */

class BacklogItem {
  const BacklogItem({
    required this.id,
    required this.userId,
    required this.title,
    this.type = 'Topic',
    this.subject,
    this.chapterId,
    this.priority = 'Medium',
    this.dueOn,
    this.status = 'active',
    this.snoozedUntil,
    this.completedAt,
    this.notes = '',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String title;
  final String type;
  final String? subject;
  final String? chapterId;
  final String priority;
  final String? dueOn;
  final String status;
  final String? snoozedUntil;
  final String? completedAt;
  final String notes;
  final String createdAt;
  final String updatedAt;

  bool get isDone => status == 'done';

  factory BacklogItem.fromMap(Map<String, dynamic> raw) => BacklogItem(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        title: _str(raw['title']),
        type: _str(raw['type'], 'Topic'),
        subject: _strOrNull(raw['subject']),
        chapterId: _strOrNull(raw['chapter_id']),
        priority: _str(raw['priority'], 'Medium'),
        dueOn: _strOrNull(raw['due_on']),
        status: _str(raw['status'], 'active'),
        snoozedUntil: _strOrNull(raw['snoozed_until']),
        completedAt: _strOrNull(raw['completed_at']),
        notes: _str(raw['notes']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'title': title,
        'type': type,
        'subject': subject,
        'chapter_id': chapterId,
        'priority': priority,
        'due_on': dueOn,
        'status': status,
        'snoozed_until': snoozedUntil,
        'completed_at': completedAt,
        'notes': notes,
      };
}

/* ------------------------------------------------------------------ */
/* Study cards (formulas / flashcards)                                 */
/* ------------------------------------------------------------------ */

String? _cardRating(Object? raw) {
  final String? value = _strOrNull(raw);
  return const <String>['again', 'hard', 'good', 'easy'].contains(value) ? value : null;
}

class StudyCard {
  const StudyCard({
    required this.id,
    required this.userId,
    required this.chapterId,
    required this.kind,
    required this.front,
    required this.back,
    this.hint = '',
    this.position = 0,
    this.difficulty,
    this.lastRating,
    this.reviews = 0,
    this.lastReviewedAt,
    this.nextReviewAt,
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String chapterId;
  final String kind;
  final String front;
  final String back;
  final String hint;
  final int position;
  final String? difficulty;

  /// Again / Hard / Good / Easy. Null for cards reviewed before the four-button
  /// review existed (or on a database without the column).
  final String? lastRating;
  final int reviews;
  final String? lastReviewedAt;
  final String? nextReviewAt;
  final String createdAt;
  final String updatedAt;

  factory StudyCard.fromMap(Map<String, dynamic> raw) => StudyCard(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        chapterId: _str(raw['chapter_id']),
        kind: _str(raw['kind'], 'flashcard'),
        front: _str(raw['front']),
        back: _str(raw['back']),
        hint: _str(raw['hint']),
        position: _int(raw['position']),
        difficulty: _strOrNull(raw['difficulty']),
        lastRating: _cardRating(raw['last_rating']),
        reviews: _int(raw['reviews']),
        lastReviewedAt: _strOrNull(raw['last_reviewed_at']),
        nextReviewAt: _strOrNull(raw['next_review_at']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'chapter_id': chapterId,
        'kind': kind,
        'front': front,
        'back': back,
        'hint': hint,
        'position': position,
        'difficulty': difficulty,
        'last_rating': lastRating,
        'reviews': reviews,
        'last_reviewed_at': lastReviewedAt,
        'next_review_at': nextReviewAt,
      };

  StudyCard copyWith({
    String? front,
    String? back,
    String? hint,
    int? position,
    Object? difficulty = _sentinel,
    Object? lastRating = _sentinel,
    int? reviews,
    Object? lastReviewedAt = _sentinel,
    Object? nextReviewAt = _sentinel,
  }) =>
      StudyCard(
        id: id,
        userId: userId,
        chapterId: chapterId,
        kind: kind,
        front: front ?? this.front,
        back: back ?? this.back,
        hint: hint ?? this.hint,
        position: position ?? this.position,
        difficulty: difficulty == _sentinel ? this.difficulty : difficulty as String?,
        lastRating: lastRating == _sentinel ? this.lastRating : lastRating as String?,
        reviews: reviews ?? this.reviews,
        lastReviewedAt: lastReviewedAt == _sentinel ? this.lastReviewedAt : lastReviewedAt as String?,
        nextReviewAt: nextReviewAt == _sentinel ? this.nextReviewAt : nextReviewAt as String?,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );
}

/* ------------------------------------------------------------------ */
/* Mock deep-dive                                                      */
/* ------------------------------------------------------------------ */

const List<String> errorCategories = <String>[
  'Silly mistake',
  'Concept gap',
  'Calculation error',
  'Time pressure',
  'Misread question',
  'Guess / bad attempt',
  'Unattempted',
];

class TestErrorLog {
  const TestErrorLog({
    required this.id,
    required this.userId,
    required this.testId,
    this.chapterId,
    this.subject,
    required this.category,
    this.marksLost,
    this.questions,
    this.note = '',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String testId;
  final String? chapterId;
  final String? subject;
  final String category;
  final double? marksLost;
  final int? questions;
  final String note;
  final String createdAt;
  final String updatedAt;

  factory TestErrorLog.fromMap(Map<String, dynamic> raw) => TestErrorLog(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        testId: _str(raw['test_id']),
        chapterId: _strOrNull(raw['chapter_id']),
        subject: _strOrNull(raw['subject']),
        category: _str(raw['category'], 'Silly mistake'),
        marksLost: _numOrNull(raw['marks_lost']),
        questions: _intOrNull(raw['questions']),
        note: _str(raw['note']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'test_id': testId,
        'chapter_id': chapterId,
        'subject': subject,
        'category': category,
        'marks_lost': marksLost,
        'questions': questions,
        'note': note,
      };
}

class TestTimeEntry {
  const TestTimeEntry({
    required this.id,
    required this.userId,
    required this.testId,
    this.subject,
    this.label = '',
    this.minutes,
    this.attempted,
    this.unattempted,
    this.orderIndex = 0,
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String testId;
  final String? subject;
  final String label;
  final int? minutes;
  final int? attempted;
  final int? unattempted;
  final int orderIndex;
  final String createdAt;
  final String updatedAt;

  factory TestTimeEntry.fromMap(Map<String, dynamic> raw) => TestTimeEntry(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        testId: _str(raw['test_id']),
        subject: _strOrNull(raw['subject']),
        label: _str(raw['label']),
        minutes: _intOrNull(raw['minutes']),
        attempted: _intOrNull(raw['attempted']),
        unattempted: _intOrNull(raw['unattempted']),
        orderIndex: _int(raw['order_index']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'test_id': testId,
        'subject': subject,
        'label': label,
        'minutes': minutes,
        'attempted': attempted,
        'unattempted': unattempted,
        'order_index': orderIndex,
      };
}

/* ------------------------------------------------------------------ */
/* Mistakes, tasks, goals, study sessions, exam tracks                 */
/* ------------------------------------------------------------------ */

class Mistake {
  const Mistake({
    required this.id,
    required this.userId,
    required this.chapterId,
    this.testId,
    required this.mistakeType,
    required this.questionNote,
    this.solutionNote = '',
    this.imagePath,
    this.retryLater = false,
    this.retryStatus = 'pending',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String chapterId;
  final String? testId;
  final String mistakeType;
  final String questionNote;
  final String solutionNote;
  final String? imagePath;
  final bool retryLater;
  final String retryStatus;
  final String createdAt;
  final String updatedAt;

  factory Mistake.fromMap(Map<String, dynamic> raw) => Mistake(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        chapterId: _str(raw['chapter_id']),
        testId: _strOrNull(raw['test_id']),
        mistakeType: _str(raw['mistake_type'], 'Concept'),
        questionNote: _str(raw['question_note']),
        solutionNote: _str(raw['solution_note']),
        imagePath: _strOrNull(raw['image_path']),
        retryLater: _bool(raw['retry_later']),
        retryStatus: _str(raw['retry_status'], 'pending'),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'chapter_id': chapterId,
        'test_id': testId,
        'mistake_type': mistakeType,
        'question_note': questionNote,
        'solution_note': solutionNote,
        'image_path': imagePath,
        'retry_later': retryLater,
        'retry_status': retryStatus,
      };

  Mistake copyWith({String? retryStatus, String? solutionNote, bool? retryLater, String? imagePath}) => Mistake(
        id: id,
        userId: userId,
        chapterId: chapterId,
        testId: testId,
        mistakeType: mistakeType,
        questionNote: questionNote,
        solutionNote: solutionNote ?? this.solutionNote,
        imagePath: imagePath ?? this.imagePath,
        retryLater: retryLater ?? this.retryLater,
        retryStatus: retryStatus ?? this.retryStatus,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );
}

class DailyTask {
  const DailyTask({
    required this.id,
    required this.userId,
    required this.title,
    this.subject,
    this.chapterId,
    this.topic,
    this.estimatedMinutes = 30,
    this.priority = 'Medium',
    this.isCompleted = false,
    required this.taskDate,
    this.position = 0,
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String title;
  final String? subject;
  final String? chapterId;

  /// Optional topic / subtopic. Null on older rows.
  final String? topic;
  final int estimatedMinutes;
  final String priority;
  final bool isCompleted;
  final String taskDate;
  final int position;
  final String createdAt;
  final String updatedAt;

  factory DailyTask.fromMap(Map<String, dynamic> raw) => DailyTask(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        title: _str(raw['title']),
        subject: _strOrNull(raw['subject']),
        chapterId: _strOrNull(raw['chapter_id']),
        topic: _strOrNull(raw['topic']),
        estimatedMinutes: _int(raw['estimated_minutes'], 30),
        priority: _str(raw['priority'], 'Medium'),
        isCompleted: _bool(raw['is_completed']),
        taskDate: _str(raw['task_date']),
        position: _int(raw['position']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'title': title,
        'subject': subject,
        'chapter_id': chapterId,
        'topic': topic,
        'estimated_minutes': estimatedMinutes,
        'priority': priority,
        'is_completed': isCompleted,
        'task_date': taskDate,
        'position': position,
      };

  DailyTask copyWith({bool? isCompleted, int? position, String? title, int? estimatedMinutes}) => DailyTask(
        id: id,
        userId: userId,
        title: title ?? this.title,
        subject: subject,
        chapterId: chapterId,
        topic: topic,
        estimatedMinutes: estimatedMinutes ?? this.estimatedMinutes,
        priority: priority,
        isCompleted: isCompleted ?? this.isCompleted,
        taskDate: taskDate,
        position: position ?? this.position,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );
}

class WeeklyGoal {
  const WeeklyGoal({
    required this.id,
    required this.userId,
    required this.goalType,
    required this.title,
    required this.target,
    this.progressValue = 0,
    required this.weekStart,
    this.unit = '',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String goalType;
  final String title;
  final double target;
  final double progressValue;
  final String weekStart;
  final String unit;
  final String createdAt;
  final String updatedAt;

  double get progress => target > 0 ? (progressValue / target).clamp(0, 1).toDouble() : 0;

  factory WeeklyGoal.fromMap(Map<String, dynamic> raw) => WeeklyGoal(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        goalType: _str(raw['goal_type'], 'custom'),
        title: _str(raw['title']),
        target: _numOrNull(raw['target']) ?? 1,
        progressValue: _numOrNull(raw['progress_value']) ?? 0,
        weekStart: _str(raw['week_start']),
        unit: _str(raw['unit']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'goal_type': goalType,
        'title': title,
        'target': target,
        'progress_value': progressValue,
        'week_start': weekStart,
        'unit': unit,
      };

  WeeklyGoal copyWith({double? progressValue}) => WeeklyGoal(
        id: id,
        userId: userId,
        goalType: goalType,
        title: title,
        target: target,
        progressValue: progressValue ?? this.progressValue,
        weekStart: weekStart,
        unit: unit,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );
}

class StudySession {
  const StudySession({
    required this.id,
    required this.userId,
    this.subject,
    this.chapterId,
    required this.startedAt,
    this.endedAt,
    this.durationMinutes = 0,
    this.completionState = 'completed',
    this.mode = 'Pomodoro',
    this.activity = 'Practice',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String? subject;
  final String? chapterId;
  final String startedAt;
  final String? endedAt;
  final int durationMinutes;
  final String completionState;
  final String mode;
  final String activity;
  final String createdAt;
  final String updatedAt;

  factory StudySession.fromMap(Map<String, dynamic> raw) => StudySession(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        subject: _strOrNull(raw['subject']),
        chapterId: _strOrNull(raw['chapter_id']),
        startedAt: _str(raw['started_at']),
        endedAt: _strOrNull(raw['ended_at']),
        durationMinutes: _int(raw['duration_minutes']),
        completionState: _str(raw['completion_state'], 'completed'),
        mode: _str(raw['mode'], 'Pomodoro'),
        activity: _str(raw['activity'], 'Practice'),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'subject': subject,
        'chapter_id': chapterId,
        'started_at': startedAt,
        'ended_at': endedAt,
        'duration_minutes': durationMinutes,
        // The schema accepts only 'completed' and 'interrupted'. Older app builds wrote
        // 'abandoned' for an ended-early block, which the server rejected; map it so the
        // same meaning (a saved partial block) can be stored.
        'completion_state': completionState == 'abandoned' ? 'interrupted' : completionState,
        'mode': mode,
        'activity': activity,
      };
}

class UserExamTrack {
  const UserExamTrack({
    required this.id,
    required this.userId,
    required this.track,
    this.label = '',
    this.examDate,
    this.enabled = true,
    this.targetScore,
    this.notes = '',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final String id;
  final String userId;
  final String track;
  final String label;
  final String? examDate;
  final bool enabled;
  final double? targetScore;
  final String notes;
  final String createdAt;
  final String updatedAt;

  factory UserExamTrack.fromMap(Map<String, dynamic> raw) => UserExamTrack(
        id: _str(raw['id']),
        userId: _str(raw['user_id']),
        track: _str(raw['track'], 'main1'),
        label: _str(raw['label']),
        examDate: _strOrNull(raw['exam_date']),
        enabled: _bool(raw['enabled'], true),
        targetScore: _numOrNull(raw['target_score']),
        notes: _str(raw['notes']),
        createdAt: _str(raw['created_at']),
        updatedAt: _str(raw['updated_at']),
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'id': id,
        'user_id': userId,
        'track': track,
        'label': label,
        'exam_date': examDate,
        'enabled': enabled,
        'target_score': targetScore,
        'notes': notes,
      };

  UserExamTrack copyWith(
          {String? label, Object? examDate = _sentinel, bool? enabled, Object? targetScore = _sentinel}) =>
      UserExamTrack(
        id: id,
        userId: userId,
        track: track,
        label: label ?? this.label,
        examDate: examDate == _sentinel ? this.examDate : examDate as String?,
        enabled: enabled ?? this.enabled,
        targetScore: targetScore == _sentinel ? this.targetScore : targetScore as double?,
        notes: notes,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );
}

/// One row of the published `exam_catalog` table (read-only for students).
class ExamCatalogEntry {
  const ExamCatalogEntry({
    required this.id,
    required this.name,
    required this.category,
    this.years = const <int>[],
    this.sessions = const <String>[],
    this.boards = const <String>[],
    this.boardsAddon = false,
    this.subjects = const <String>[],
    this.sessionLabel = '',
    this.sortOrder = 0,
    this.markingScheme,
  });

  final String id;
  final String name;
  final String category;

  /// Raw `exam_catalog.marking_scheme` JSON (validated by logic/marking.dart before use).
  final Map<String, dynamic>? markingScheme;
  final List<int> years;
  final List<String> sessions;
  final List<String> boards;
  final bool boardsAddon;
  final List<String> subjects;
  final String sessionLabel;
  final int sortOrder;

  factory ExamCatalogEntry.fromMap(Map<String, dynamic> raw) => ExamCatalogEntry(
        id: _str(raw['id']),
        name: _str(raw['name']),
        category: _str(raw['category']),
        years: _intList(raw['years']),
        sessions: _stringList(raw['sessions']),
        boards: _stringList(raw['boards']),
        boardsAddon: _bool(raw['boards_addon']),
        subjects: _stringList(raw['subjects']),
        sessionLabel: _str(raw['session_label']),
        sortOrder: _int(raw['sort_order']),
        markingScheme: raw['marking_scheme'] is Map ? Map<String, dynamic>.from(raw['marking_scheme'] as Map) : null,
      );
}
