import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/errors.dart';
import 'app_data.dart';
import 'app_data_codec.dart';
import 'models.dart';
import 'repository.dart';
import 'syllabus_seed.dart';

/// Everything the notebook shows, plus the state of the last sync.
class DataState {
  const DataState({
    required this.data,
    this.loading = false,
    this.saving = false,
    this.error,
    this.offline = false,
    this.lastSyncedAt,
  });

  final AppData data;
  final bool loading;
  final bool saving;
  final String? error;

  /// True when the last load failed and the screen is showing the cached copy.
  final bool offline;
  final String? lastSyncedAt;

  DataState copyWith({
    AppData? data,
    bool? loading,
    bool? saving,
    Object? error = _none,
    bool? offline,
    Object? lastSyncedAt = _none,
  }) =>
      DataState(
        data: data ?? this.data,
        loading: loading ?? this.loading,
        saving: saving ?? this.saving,
        error: error == _none ? this.error : error as String?,
        offline: offline ?? this.offline,
        lastSyncedAt: lastSyncedAt == _none ? this.lastSyncedAt : lastSyncedAt as String?,
      );
}

const Object _none = Object();

/// Owns the account's notebook: loads it from Supabase, keeps an offline snapshot, and
/// writes every change straight back to the same tables the website uses.
///
/// Writes are applied to the server first and then to local state, so a failed save never
/// leaves the screen claiming something was stored. The message shown on failure is the
/// repository's user-facing one, never a raw Postgres error.
class DataController extends StateNotifier<DataState> {
  DataController({
    required StrackerRepository repository,
    required SharedPreferences preferences,
    required String userId,
  })  : _repository = repository,
        _prefs = preferences,
        _userId = userId,
        super(DataState(data: AppData.empty(userId), loading: true)) {
    _restoreSnapshot();
  }

  final StrackerRepository _repository;
  final SharedPreferences _prefs;
  final String _userId;

  String get _cacheKey => 'stracker.cache.$_userId';

  /// Device-only value for this account (never synced), e.g. the running focus timer.
  String? readDeviceValue(String name) => _prefs.getString('stracker.$name.$_userId');

  Future<void> writeDeviceValue(String name, String? value) async {
    try {
      final String key = 'stracker.$name.$_userId';
      if (value == null) {
        await _prefs.remove(key);
      } else {
        await _prefs.setString(key, value);
      }
    } catch (_) {
      // Losing a device-only value never blocks the app.
    }
  }

  void _restoreSnapshot() {
    final String? raw = _prefs.getString(_cacheKey);
    if (raw == null) return;
    final AppData? cached = AppDataCodec.decode(raw, _userId);
    if (cached != null) {
      state = state.copyWith(data: cached);
    }
  }

  Future<void> _writeSnapshot(AppData data) async {
    try {
      await _prefs.setString(_cacheKey, AppDataCodec.encode(data));
    } catch (_) {
      // A cache write failure only costs offline support; it must never fail the load.
    }
  }

  /// Loads every table. When the network is unavailable the cached notebook stays and the
  /// state is marked offline, with the reason in `error`.
  Future<void> load({bool silent = false}) async {
    // Silent refreshes keep the current frame on screen: pull-to-refresh and the sync pill
    // should not replace a populated page with a spinner.
    state = silent ? state.copyWith(error: null) : state.copyWith(loading: true, error: null);
    try {
      final List<Object> results = await Future.wait<Object>(<Future<Object>>[
        _repository.fetchRows('app_settings', _userId),
        _repository.fetchRows('profiles', _userId),
        _repository.fetchRows('chapters', _userId),
        _repository.fetchRows('chapter_revisions', _userId),
        _repository.fetchRows('tests', _userId),
        _repository.fetchRows('test_subject_scores', _userId),
        _repository.fetchRows('test_chapter_links', _userId),
        _repository.fetchRows('mistakes', _userId),
        _repository.fetchRows('daily_tasks', _userId),
        _repository.fetchRows('weekly_goals', _userId),
        _repository.fetchRows('study_sessions', _userId),
        _repository.fetchRows('practice_sessions', _userId),
        _repository.fetchRows('pyq_records', _userId),
        _repository.fetchRows('chapter_stages', _userId),
        _repository.fetchRows('backlog_items', _userId),
        _repository.fetchRows('study_cards', _userId),
        _repository.fetchRows('test_error_logs', _userId),
        _repository.fetchRows('test_time_entries', _userId),
        _repository.fetchRows('user_exam_tracks', _userId),
        _repository.fetchExamCatalog(),
      ]);

      List<Map<String, dynamic>> rows(int index) =>
          (results[index] as List<Map<String, dynamic>>);

      final List<Map<String, dynamic>> settingsRows = rows(0);
      final List<Map<String, dynamic>> profileRows = rows(1);
      final bool firstRun = settingsRows.isEmpty && rows(2).isEmpty;

      AppData data = AppData(
        userId: _userId,
        settings: settingsRows.isEmpty
            ? AppSettings.defaults(_userId)
            : AppSettings.fromMap(settingsRows.first, _userId),
        profile: profileRows.isEmpty ? null : Profile.fromMap(profileRows.first),
        chapters: rows(2).map(Chapter.fromMap).toList(),
        revisions: rows(3).map(Revision.fromMap).toList(),
        tests: rows(4).map(TestRecord.fromMap).toList(),
        testSubjectScores: rows(5).map(TestSubjectScore.fromMap).toList(),
        testChapterLinks: rows(6).map(TestChapterLink.fromMap).toList(),
        mistakes: rows(7).map(Mistake.fromMap).toList(),
        tasks: rows(8).map(DailyTask.fromMap).toList(),
        goals: rows(9).map(WeeklyGoal.fromMap).toList(),
        sessions: rows(10).map(StudySession.fromMap).toList(),
        practiceSessions: rows(11).map(PracticeSession.fromMap).toList(),
        pyqRecords: rows(12).map(PyqRecord.fromMap).toList(),
        chapterStages: rows(13).map(ChapterStageRow.fromMap).toList(),
        backlogItems: rows(14).map(BacklogItem.fromMap).toList(),
        studyCards: rows(15).map(StudyCard.fromMap).toList(),
        errorLogs: rows(16).map(TestErrorLog.fromMap).toList(),
        timeEntries: rows(17).map(TestTimeEntry.fromMap).toList(),
        examTracks: rows(18).map(UserExamTrack.fromMap).toList(),
        examCatalog: (results[19] as List<ExamCatalogEntry>),
      );

      if (firstRun) {
        data = await _bootstrap(data);
      } else {
        if (settingsRows.isEmpty) {
          await _repository.upsertRow('app_settings', data.settings.toMap());
        }
        if (profileRows.isEmpty) {
          data = data.copyWith(profile: await _ensureProfile(data));
        }
      }

      state = DataState(
        data: data,
        loading: false,
        lastSyncedAt: isoNow(),
      );
      await _writeSnapshot(data);
    } catch (error) {
      if (_isAuthFailure(error)) {
        // A revoked or expired sign-in makes every table answer 401. Showing that as a
        // notebook error leaves the student stuck; return to sign-in instead. The cached
        // copy stays on the device for the next sign-in.
        state = state.copyWith(
          loading: false,
          offline: true,
          error: 'Your session expired. Sign in again to continue syncing.',
        );
        await _repository.endLostSession();
        return;
      }
      final String message = error is AppFailure
          ? error.message
          : 'Your notebook could not be refreshed. Showing the copy saved on this device.';
      state = state.copyWith(loading: false, offline: true, error: message);
    }
  }

  bool _isAuthFailure(Object error) {
    final String? code = error is AppFailure ? error.code : null;
    if (code == 'PGRST301' || code == 'PGRST302' || code == 'PGRST303') return true;
    return (code == '42501' || code == '401') && _repository.sessionLost;
  }

  /// First sign-in: create the profile, settings, exam tracks and the JEE syllabus so the
  /// account works on both the app and the website immediately. This mirrors the website's
  /// first-run seeding and only ever runs when both settings and chapters are empty.
  Future<AppData> _bootstrap(AppData data) async {
    final Profile profile = await _ensureProfile(data);
    final AppSettings settings = data.settings.copyWith(onboardingCompleted: true);
    await _repository.upsertRow('app_settings', settings.toMap());
    // Exactly like the website: only a JEE notebook is seeded with the JEE syllabus. Other
    // exams start with an empty syllabus and the student adds chapters from their own
    // subject list, because the shared syllabus text belongs to JEE alone.
    final bool seedJee = isJeeExam(settings.examId);
    final List<Chapter> chapters = <Chapter>[];
    int position = 0;
    for (final MapEntry<String, List<String>> entry in seedJee ? seededSyllabus.entries : const <MapEntry<String, List<String>>>[]) {
      for (final String name in entry.value) {
        chapters.add(Chapter(
          id: newId(),
          userId: _userId,
          subject: entry.key,
          name: name,
          position: position,
          createdAt: isoNow(),
          updatedAt: isoNow(),
        ));
        position += 1;
      }
    }
    if (chapters.isNotEmpty) {
      await _repository.upsertRows(
        'chapters',
        chapters.map((Chapter chapter) => chapter.toMap()).toList(),
      );
    }
    final List<UserExamTrack> tracks = seedExamTracks(_userId);
    await _repository.upsertRows(
      'user_exam_tracks',
      tracks.map((UserExamTrack track) => track.toMap()).toList(),
    );
    return data.copyWith(profile: profile, settings: settings, chapters: chapters, examTracks: tracks);
  }

  Future<Profile> _ensureProfile(AppData data) async {
    final String? email = SupabaseAuth.email;
    final String? displayName = SupabaseAuth.displayName;
    final Profile existing = data.profile ??
        Profile(id: _userId, userId: _userId, email: email ?? '', displayName: displayName ?? '');
    final Profile profile = existing.copyWith(
      email: existing.email.isEmpty ? (email ?? '') : existing.email,
      displayName: existing.displayName.isEmpty ? (displayName ?? '') : existing.displayName,
    );
    await _repository.upsertRow('profiles', profile.toMap());
    return profile;
  }

  /* ------------------------------------------------------------------ */
  /* Generic write plumbing                                             */
  /* ------------------------------------------------------------------ */

  /// Optimistic write: the change shows on screen at once, the cloud write follows, and a
  /// failure rolls the screen back (or reloads if other edits landed meanwhile) and rethrows.
  Future<void> _run(Future<void> Function() action, Future<void> Function() apply) async {
    final AppData before = state.data;
    state = state.copyWith(saving: true, error: null);
    await apply();
    final AppData optimistic = state.data;
    try {
      await action();
      state = state.copyWith(saving: false, offline: false);
    } catch (error) {
      final String message =
          error is AppFailure ? error.message : 'That change could not be saved. Try again.';
      if (identical(state.data, optimistic)) {
        _apply(before);
      } else {
        unawaited(load(silent: true));
      }
      state = state.copyWith(saving: false, error: message);
      throw AppFailure(message);
    }
  }

  List<T> _put<T>(List<T> rows, T row, String Function(T) id) => <T>[
        for (final T item in rows)
          if (id(item) != id(row)) item,
        row,
      ];

  List<T> _drop<T>(List<T> rows, String id, String Function(T) idOf) =>
      <T>[for (final T item in rows) if (idOf(item) != id) item];

  void _apply(AppData next) {
    state = state.copyWith(data: next);
    // Snapshot writes are cheap and keep the offline copy current after every change.
    _writeSnapshot(next);
  }

  /* ------------------------------------------------------------------ */
  /* Settings, profile, exam tracks                                     */
  /* ------------------------------------------------------------------ */

  Future<void> saveSettings(AppSettings settings) async {
    final AppSettings next = settings.copyWithUpdated();
    await _run(
      () => _repository.upsertRow('app_settings', next.toMap()),
      () async => _apply(state.data.copyWith(settings: next)),
    );
  }

  Future<void> saveProfile(Profile profile) async {
    await _run(
      () => _repository.upsertRow('profiles', <String, dynamic>{
        'id': profile.id,
        'user_id': _userId,
        'display_name': profile.displayName,
        'email': profile.email,
      }),
      () async => _apply(state.data.copyWith(profile: profile)),
    );
  }

  Future<void> saveExamTrack(UserExamTrack track) async {
    await _run(
      () => _repository.upsertRow('user_exam_tracks', track.toMap()),
      () async => _apply(state.data.copyWith(
            examTracks: _put(state.data.examTracks, track, (UserExamTrack row) => row.track),
          )),
    );
  }

  /* ------------------------------------------------------------------ */
  /* Chapters and revisions                                             */
  /* ------------------------------------------------------------------ */

  Future<void> saveChapter(Chapter chapter) async {
    await _run(
      () => _repository.upsertRow('chapters', chapter.toMap()),
      () async => _apply(state.data.copyWith(
            chapters: _put(state.data.chapters, chapter, (Chapter row) => row.id),
          )),
    );
  }

  Future<void> saveChapters(List<Chapter> chapters) async {
    if (chapters.isEmpty) return;
    await _run(
      () => _repository.upsertRows('chapters', chapters.map((Chapter row) => row.toMap()).toList()),
      () async {
        List<Chapter> rows = state.data.chapters;
        for (final Chapter chapter in chapters) {
          rows = _put(rows, chapter, (Chapter row) => row.id);
        }
        _apply(state.data.copyWith(chapters: rows));
      },
    );
  }

  /// Deletes a chapter and everything that hangs off it, so the account has no orphans
  /// that would confuse the website's chapter lists.
  Future<void> deleteChapter(Chapter chapter) async {
    await _run(
      () async {
        // One filtered delete per child table, all in parallel, then the chapter itself.
        await Future.wait(<Future<void>>[
          for (final String table in const <String>[
            'chapter_revisions',
            'chapter_stages',
            'practice_sessions',
            'pyq_records',
            'study_cards',
            'test_chapter_links',
          ])
            _repository.deleteWhere(table, 'chapter_id', chapter.id, _userId),
        ]);
        await _repository.deleteRow('chapters', chapter.id, _userId);
      },
      () async {
        _apply(state.data.copyWith(
          chapters: _drop(state.data.chapters, chapter.id, (Chapter row) => row.id),
          revisions: state.data.revisions
              .where((Revision row) => row.chapterId != chapter.id)
              .toList(),
          chapterStages: state.data.chapterStages
              .where((ChapterStageRow row) => row.chapterId != chapter.id)
              .toList(),
          practiceSessions: state.data.practiceSessions
              .where((PracticeSession row) => row.chapterId != chapter.id)
              .toList(),
          pyqRecords:
              state.data.pyqRecords.where((PyqRecord row) => row.chapterId != chapter.id).toList(),
          studyCards:
              state.data.studyCards.where((StudyCard row) => row.chapterId != chapter.id).toList(),
          testChapterLinks: state.data.testChapterLinks
              .where((TestChapterLink row) => row.chapterId != chapter.id)
              .toList(),
        ));
      },
    );
  }

  Future<void> saveRevisions(List<Revision> revisions) async {
    if (revisions.isEmpty) return;
    await _run(
      () => _repository
          .upsertRows('chapter_revisions', revisions.map((Revision row) => row.toMap()).toList()),
      () async {
        List<Revision> rows = state.data.revisions;
        for (final Revision revision in revisions) {
          rows = _put(rows, revision, (Revision row) => row.id);
        }
        _apply(state.data.copyWith(revisions: rows));
      },
    );
  }

  Future<void> saveRevision(Revision revision) => saveRevisions(<Revision>[revision]);

  Future<void> deleteRevision(Revision revision) async {
    await _run(
      () => _repository.deleteRow('chapter_revisions', revision.id, _userId),
      () async => _apply(state.data.copyWith(
            revisions: _drop(state.data.revisions, revision.id, (Revision row) => row.id),
          )),
    );
  }

  /* ------------------------------------------------------------------ */
  /* Tests                                                              */
  /* ------------------------------------------------------------------ */

  Future<void> saveTest(TestRecord test, {List<TestSubjectScore>? subjectScores}) async {
    await _run(
      () async {
        await _repository.upsertRow('tests', test.toMap());
        // A Full Mock has no single chapter: drop any chapter link left from an earlier type.
        if (test.testType == 'Full Mock') {
          await _repository.deleteWhere('test_chapter_links', 'test_id', test.id, _userId);
        }
        if (subjectScores != null) {
          if (subjectScores.isEmpty) {
            await _repository.deleteWhere('test_subject_scores', 'test_id', test.id, _userId);
          } else {
            await _repository.upsertRows(
              'test_subject_scores',
              subjectScores.map((TestSubjectScore row) => row.toMap()).toList(),
            );
          }
        }
      },
      () async {
        List<TestSubjectScore> scores = state.data.testSubjectScores;
        if (subjectScores != null) {
          scores = subjectScores.isEmpty
              ? scores.where((TestSubjectScore row) => row.testId != test.id).toList()
              : <TestSubjectScore>[
                  for (final TestSubjectScore row in scores)
                    if (row.testId != test.id ||
                        !subjectScores.any((TestSubjectScore next) => next.subject == row.subject))
                      row,
                  ...subjectScores,
                ];
        }
        _apply(state.data.copyWith(
          tests: _put(state.data.tests, test, (TestRecord row) => row.id),
          testSubjectScores: scores,
          testChapterLinks: test.testType == 'Full Mock'
              ? state.data.testChapterLinks
                  .where((TestChapterLink row) => row.testId != test.id)
                  .toList()
              : state.data.testChapterLinks,
        ));
      },
    );
  }

  Future<void> deleteTest(TestRecord test) async {
    await _run(
      () async {
        await Future.wait(<Future<void>>[
          for (final String table in const <String>[
            'test_subject_scores',
            'test_chapter_links',
            'test_error_logs',
            'test_time_entries',
          ])
            _repository.deleteWhere(table, 'test_id', test.id, _userId),
        ]);
        await _repository.deleteRow('tests', test.id, _userId);
      },
      () async => _apply(state.data.copyWith(
            tests: _drop(state.data.tests, test.id, (TestRecord row) => row.id),
            testSubjectScores: state.data.testSubjectScores
                .where((TestSubjectScore row) => row.testId != test.id)
                .toList(),
            testChapterLinks: state.data.testChapterLinks
                .where((TestChapterLink row) => row.testId != test.id)
                .toList(),
            errorLogs:
                state.data.errorLogs.where((TestErrorLog row) => row.testId != test.id).toList(),
            timeEntries:
                state.data.timeEntries.where((TestTimeEntry row) => row.testId != test.id).toList(),
          )),
    );
  }

  Future<void> saveErrorLog(TestErrorLog log) async {
    await _run(
      () => _repository.upsertRow('test_error_logs', log.toMap()),
      () async => _apply(state.data.copyWith(
            errorLogs: _put(state.data.errorLogs, log, (TestErrorLog row) => row.id),
          )),
    );
  }

  Future<void> deleteErrorLog(TestErrorLog log) async {
    await _run(
      () => _repository.deleteRow('test_error_logs', log.id, _userId),
      () async => _apply(state.data.copyWith(
            errorLogs: _drop(state.data.errorLogs, log.id, (TestErrorLog row) => row.id),
          )),
    );
  }

  Future<void> saveTimeEntry(TestTimeEntry entry) async {
    await _run(
      () => _repository.upsertRow('test_time_entries', entry.toMap()),
      () async => _apply(state.data.copyWith(
            timeEntries: _put(state.data.timeEntries, entry, (TestTimeEntry row) => row.id),
          )),
    );
  }

  Future<void> deleteTimeEntry(TestTimeEntry entry) async {
    await _run(
      () => _repository.deleteRow('test_time_entries', entry.id, _userId),
      () async => _apply(state.data.copyWith(
            timeEntries: _drop(state.data.timeEntries, entry.id, (TestTimeEntry row) => row.id),
          )),
    );
  }

  /* ------------------------------------------------------------------ */
  /* Practice, PYQ, stages                                              */
  /* ------------------------------------------------------------------ */

  Future<void> savePractice(PracticeSession session) async {
    await _run(
      () => _repository.upsertRow('practice_sessions', session.toMap()),
      () async => _apply(state.data.copyWith(
            practiceSessions: _put(
              state.data.practiceSessions,
              session,
              (PracticeSession row) => row.id,
            ),
          )),
    );
  }

  Future<void> deletePractice(PracticeSession session) async {
    await _run(
      () => _repository.deleteRow('practice_sessions', session.id, _userId),
      () async => _apply(state.data.copyWith(
            practiceSessions: _drop(
              state.data.practiceSessions,
              session.id,
              (PracticeSession row) => row.id,
            ),
          )),
    );
  }

  Future<void> savePyq(PyqRecord record) async {
    await _run(
      () => _repository.upsertRow('pyq_records', record.toMap()),
      () async => _apply(state.data.copyWith(
            pyqRecords: _put(state.data.pyqRecords, record, (PyqRecord row) => row.id),
          )),
    );
  }

  Future<void> savePyqMany(List<PyqRecord> records) async {
    if (records.isEmpty) return;
    await _run(
      () => _repository.upsertRows(
        'pyq_records',
        records.map((PyqRecord row) => row.toMap()).toList(),
      ),
      () async {
        List<PyqRecord> rows = state.data.pyqRecords;
        for (final PyqRecord record in records) {
          rows = _put(rows, record, (PyqRecord row) => row.id);
        }
        _apply(state.data.copyWith(pyqRecords: rows));
      },
    );
  }

  Future<void> saveStage(ChapterStageRow stage) async {
    await _run(
      () => _repository.upsertRow('chapter_stages', stage.toMap()),
      () async => _apply(state.data.copyWith(
            chapterStages: _put(
              state.data.chapterStages,
              stage,
              (ChapterStageRow row) => '${row.chapterId}:${row.stage}',
            ),
          )),
    );
  }

  /* ------------------------------------------------------------------ */
  /* Mistakes (private images), tasks, goals, backlog, cards, sessions  */
  /* ------------------------------------------------------------------ */

  Future<void> saveMistake(Mistake mistake, {File? image}) async {
    late Mistake stored;
    await _run(
      () async {
        String? path = mistake.imagePath;
        if (image != null) {
          // Uploaded under <user uuid>/<mistake id>.webp, the same private bucket and
          // content type the website uses, so both clients see the same object.
          path = await _repository.uploadMistakeImage(_userId, image, mistake.id);
        }
        stored = path == mistake.imagePath ? mistake : mistake.copyWith(imagePath: path);
        await _repository.upsertRow('mistakes', stored.toMap());
      },
      () async => _apply(state.data.copyWith(
            mistakes: _put(state.data.mistakes, stored, (Mistake row) => row.id),
          )),
    );
  }

  Future<String?> mistakeImageUrl(String path) => _repository.signedImageUrl(path);

  /// Raw bytes of a private mistake image, for the in-app thumbnail.
  Future<Uint8List?> mistakeImageBytes(String path) =>
      _repository.downloadMistakeImage(path);

  Future<void> deleteMistake(Mistake mistake) async {
    await _run(
      () async {
        await _repository.deleteRow('mistakes', mistake.id, _userId);
        final String? path = mistake.imagePath;
        if (path != null && path.isNotEmpty) {
          await _repository.removeStorageObject(path);
        }
      },
      () async => _apply(state.data.copyWith(
            mistakes: _drop(state.data.mistakes, mistake.id, (Mistake row) => row.id),
          )),
    );
  }

  Future<void> saveTask(DailyTask task) async {
    await _run(
      () => _repository.upsertRow('daily_tasks', task.toMap()),
      () async => _apply(state.data.copyWith(
            tasks: _put(state.data.tasks, task, (DailyTask row) => row.id),
          )),
    );
  }

  Future<void> deleteTask(DailyTask task) async {
    await _run(
      () => _repository.deleteRow('daily_tasks', task.id, _userId),
      () async => _apply(state.data.copyWith(
            tasks: _drop(state.data.tasks, task.id, (DailyTask row) => row.id),
          )),
    );
  }

  Future<void> saveGoal(WeeklyGoal goal) async {
    await _run(
      () => _repository.upsertRow('weekly_goals', goal.toMap()),
      () async => _apply(state.data.copyWith(
            goals: _put(state.data.goals, goal, (WeeklyGoal row) => row.id),
          )),
    );
  }

  Future<void> deleteGoal(WeeklyGoal goal) async {
    await _run(
      () => _repository.deleteRow('weekly_goals', goal.id, _userId),
      () async => _apply(state.data.copyWith(
            goals: _drop(state.data.goals, goal.id, (WeeklyGoal row) => row.id),
          )),
    );
  }

  Future<void> saveBacklog(BacklogItem item) async {
    await _run(
      () => _repository.upsertRow('backlog_items', item.toMap()),
      () async => _apply(state.data.copyWith(
            backlogItems: _put(state.data.backlogItems, item, (BacklogItem row) => row.id),
          )),
    );
  }

  Future<void> deleteBacklog(BacklogItem item) async {
    await _run(
      () => _repository.deleteRow('backlog_items', item.id, _userId),
      () async => _apply(state.data.copyWith(
            backlogItems: _drop(state.data.backlogItems, item.id, (BacklogItem row) => row.id),
          )),
    );
  }

  Future<void> saveCard(StudyCard card) async {
    await _run(
      () => _repository.upsertRow('study_cards', card.toMap()),
      () async => _apply(state.data.copyWith(
            studyCards: _put(state.data.studyCards, card, (StudyCard row) => row.id),
          )),
    );
  }

  Future<void> deleteCard(StudyCard card) async {
    await _run(
      () => _repository.deleteRow('study_cards', card.id, _userId),
      () async => _apply(state.data.copyWith(
            studyCards: _drop(state.data.studyCards, card.id, (StudyCard row) => row.id),
          )),
    );
  }

  Future<void> saveSession(StudySession session) async {
    await _run(
      () => _repository.upsertRow('study_sessions', session.toMap()),
      () async => _apply(state.data.copyWith(
            sessions: _put(state.data.sessions, session, (StudySession row) => row.id),
          )),
    );
  }

  /* ------------------------------------------------------------------ */
  /* Import and cache control                                           */
  /* ------------------------------------------------------------------ */

  /// Merges a backup file into the account. Table names are whitelisted, owner columns are
  /// rewritten to the signed-in account, and rows are upserted by id — never deleting.
  Future<int> importBackup(Map<String, dynamic> payload) async {
    const List<String> allowed = <String>[
      'app_settings',
      'profiles',
      'chapters',
      'chapter_revisions',
      'test_subject_scores',
      'test_chapter_links',
      'tests',
      'mistakes',
      'daily_tasks',
      'weekly_goals',
      'study_sessions',
      'practice_sessions',
      'pyq_records',
      'chapter_stages',
      'backlog_items',
      'study_cards',
      'test_error_logs',
      'test_time_entries',
      'user_exam_tracks',
    ];
    int written = 0;
    for (final MapEntry<String, dynamic> entry in payload.entries) {
      if (!allowed.contains(entry.key)) continue;
      final Object? value = entry.value;
      if (value is Map) {
        final Map<String, dynamic> row = Map<String, dynamic>.from(value);
        row['user_id'] = _userId;
        if (entry.key == 'app_settings' || entry.key == 'profiles') row['id'] = _userId;
        await _repository.upsertRow(entry.key, row);
        written += 1;
      } else if (value is List) {
        final List<Map<String, dynamic>> rows = <Map<String, dynamic>>[];
        for (final Object? item in value) {
          if (item is! Map) continue;
          final Map<String, dynamic> row = Map<String, dynamic>.from(item);
          row['user_id'] = _userId;
          rows.add(row);
        }
        if (rows.isNotEmpty) {
          await _repository.upsertRows(entry.key, rows);
          written += rows.length;
        }
      }
    }
    await load();
    return written;
  }

  Future<void> clearDeviceCache() async {
    await _prefs.remove(_cacheKey);
  }
}

/// Reads the few auth fields the notebook needs for its first-run profile, without holding
/// a Supabase client here.
class SupabaseAuth {
  static String? email;
  static String? displayName;
}

final StateNotifierProvider<DataController, DataState> dataControllerProvider =
    StateNotifierProvider<DataController, DataState>((Ref ref) {
  throw UnimplementedError('Override dataControllerProvider for the signed-in account.');
});
