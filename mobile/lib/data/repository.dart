import 'dart:typed_data';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/errors.dart';
import 'models.dart';

/// Every read and write the app performs, against the same Supabase project the website
/// uses. Rows are always filtered by `user_id`, so an RLS mistake on the server still
/// cannot return another account's notebook from this client.
class StrackerRepository {
  StrackerRepository(this._client);

  final SupabaseClient _client;

  static const List<String> tables = <String>[
    'profiles',
    'app_settings',
    'chapters',
    'chapter_revisions',
    'tests',
    'test_subject_scores',
    'test_chapter_links',
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

  /// True when the stored sign-in can no longer authorise requests: Supabase dropped it
  /// (for example the refresh token was revoked or already used on another device) or the
  /// access token has expired without a successful refresh. Every table then answers 401.
  bool get sessionLost {
    final Session? session = _client.auth.currentSession;
    return session == null || session.isExpired;
  }

  /// Clears the dead session on this device only, so the app returns to the sign-in screen
  /// instead of showing table errors. Other devices and the website stay signed in.
  Future<void> endLostSession() async {
    try {
      await _client.auth.signOut(scope: SignOutScope.local);
    } catch (_) {
      // Already signed out locally; the auth listener has nothing more to do.
    }
  }

  Future<List<Map<String, dynamic>>> fetchRows(String table, String userId) async {
    try {
      final List<Map<String, dynamic>> rows = await _client
          .from(table)
          .select()
          .eq('user_id', userId)
          .order('created_at', ascending: true);
      return rows;
    } on PostgrestException catch (error) {
      throw AppFailure(_friendly(error), code: error.code);
    } catch (error) {
      throw AppFailure(_friendly(error));
    }
  }

  /// Read-only catalog, published by the project owner. Students only see `hidden = false`.
  Future<List<ExamCatalogEntry>> fetchExamCatalog() async {
    try {
      final List<Map<String, dynamic>> rows = await _client
          .from('exam_catalog')
          .select()
          .eq('hidden', false)
          .order('sort_order', ascending: true);
      return rows.map(ExamCatalogEntry.fromMap).toList();
    } catch (_) {
      // The catalog is an enhancement: if the table is unavailable the app falls back to
      // the built-in JEE defaults rather than failing to open.
      return const <ExamCatalogEntry>[];
    }
  }

  Future<void> upsertRow(String table, Map<String, dynamic> row) async {
    try {
      await _client.from(table).upsert(row);
    } on PostgrestException catch (error) {
      throw AppFailure(_friendly(error), code: error.code);
    } catch (error) {
      throw AppFailure(_friendly(error));
    }
  }

  Future<void> upsertRows(String table, List<Map<String, dynamic>> rows) async {
    if (rows.isEmpty) return;
    try {
      await _client.from(table).upsert(rows);
    } on PostgrestException catch (error) {
      throw AppFailure(_friendly(error), code: error.code);
    } catch (error) {
      throw AppFailure(_friendly(error));
    }
  }

  Future<void> deleteRow(String table, String id, String userId) async {
    try {
      await _client.from(table).delete().eq('id', id).eq('user_id', userId);
    } on PostgrestException catch (error) {
      throw AppFailure(_friendly(error), code: error.code);
    } catch (error) {
      throw AppFailure(_friendly(error));
    }
  }

  /// Deletes every row of [table] owned by [userId] whose [column] equals [value], in one request
  /// (instead of downloading the table and deleting rows one by one). RLS still applies.
  Future<void> deleteWhere(String table, String column, String value, String userId) async {
    try {
      await _client.from(table).delete().eq(column, value).eq('user_id', userId);
    } on PostgrestException catch (error) {
      throw AppFailure(_friendly(error), code: error.code);
    } catch (error) {
      throw AppFailure(_friendly(error));
    }
  }

  /// Private `mistake-images` bucket. The path is `<user uuid>/<file uuid>.webp`.
  Future<String> uploadMistakeImage(String userId, File file, String objectId) async {
    final String path = '$userId/$objectId.webp';
    try {
      await _client.storage.from('mistake-images').upload(
            path,
            file,
            fileOptions: const FileOptions(upsert: true, contentType: 'image/webp'),
          );
      return path;
    } on StorageException catch (error) {
      throw AppFailure(
        error.message.toLowerCase().contains('policy')
            ? 'That image could not be uploaded. Try again.'
            : 'The question image could not be uploaded. Try again.',
      );
    }
  }

  Future<Uint8List?> downloadMistakeImage(String path) async {
    try {
      return await _client.storage.from('mistake-images').download(path);
    } catch (_) {
      return null;
    }
  }

  Future<String?> signedImageUrl(String path) async {
    try {
      return await _client.storage.from('mistake-images').createSignedUrl(path, 3600);
    } catch (_) {
      return null;
    }
  }

  Future<void> removeStorageObject(String path) async {
    try {
      await _client.storage.from('mistake-images').remove(<String>[path]);
    } catch (_) {
      // Removing an already-deleted object is not an error worth surfacing.
    }
  }

  String _friendly(Object error) {
    if (error is PostgrestException) {
      final String message = error.message.toLowerCase();
      if (message.contains('row-level security') || message.contains('permission')) {
        return "That change isn't allowed for your account.";
      }
      if (message.contains('schema cache') || message.contains('could not find the table')) {
        return 'That part of your notebook is not available right now. Pull down to refresh.';
      }
      if (message.contains('duplicate key')) {
        return 'That record already exists.';
      }
      if (message.contains('violates foreign key')) {
        return 'That record refers to something that no longer exists. Pull down to refresh, then try again.';
      }
      if (message.contains('network') || message.contains('socket')) {
        return 'Could not reach Stracker. Check your connection and try again.';
      }
      return error.message;
    }
    final String text = error.toString();
    if (text.contains('SocketException') || text.contains('Failed host lookup')) {
      return 'Could not reach Stracker. Check your connection and try again.';
    }
    return 'Something went wrong saving that change. Try again.';
  }
}
