import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stracker/data/data_controller.dart';
import 'package:stracker/data/repository.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// One request the app sent to the fake Supabase.
class RecordedRequest {
  RecordedRequest(this.method, this.url, this.headers, this.bodyBytes);

  final String method;
  final Uri url;
  final Map<String, String> headers;
  final List<int> bodyBytes;

  /// `rest` (PostgREST) or `storage`.
  String get service => url.pathSegments.isEmpty ? '' : url.pathSegments.first;

  /// The table (PostgREST) or bucket (storage) the request targets.
  String get target {
    final List<String> parts = url.pathSegments;
    if (service == 'rest') return parts.length > 2 ? parts[2] : '';
    if (service == 'storage') return parts.length > 3 ? parts[3] : '';
    return '';
  }

  /// The JSON rows of a PostgREST write (an object or a list of objects).
  List<Map<String, dynamic>> get rows {
    if (service != 'rest' || bodyBytes.isEmpty) return const <Map<String, dynamic>>[];
    final Object? decoded = jsonDecode(utf8.decode(bodyBytes));
    if (decoded is Map<String, dynamic>) return <Map<String, dynamic>>[decoded];
    if (decoded is List) return decoded.cast<Map<String, dynamic>>();
    return const <Map<String, dynamic>>[];
  }

  @override
  String toString() => '$method $url';
}

/// A stand-in for the Supabase REST and storage APIs. Every request is recorded so tests
/// can assert the exact payloads; reads answer from [tables]; a table or bucket can be set
/// to fail with a given PostgREST error, or every request can fail as if offline.
class FakeBackend {
  FakeBackend();

  final List<RecordedRequest> requests = <RecordedRequest>[];

  /// Rows returned for GET /rest/v1/<table>.
  final Map<String, List<Map<String, dynamic>>> tables = <String, List<Map<String, dynamic>>>{};

  /// Writes to these tables (or storage buckets) answer with this PostgREST error body.
  final Map<String, Map<String, dynamic>> failures = <String, Map<String, dynamic>>{};

  /// Simulates no connection: every request throws a SocketException.
  bool offline = false;

  late final SupabaseClient client = SupabaseClient(
    'http://fake.supabase.local',
    'anon-test-key',
    httpClient: MockClient(_handle),
    authOptions: const AuthClientOptions(autoRefreshToken: false),
  );

  StrackerRepository get repository => StrackerRepository(client);

  /// A [DataController] for user [userId] talking to this backend.
  Future<DataController> controller({String userId = 'u1'}) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    return DataController(repository: repository, preferences: prefs, userId: userId);
  }

  /// Write requests (POST / PATCH / DELETE) to [table].
  List<RecordedRequest> writesTo(String table) =>
      requests.where((RecordedRequest r) => r.service == 'rest' && r.target == table && r.method != 'GET').toList();

  /// Rows sent by upserts / inserts to [table], oldest first.
  List<Map<String, dynamic>> rowsSentTo(String table) => <Map<String, dynamic>>[
        for (final RecordedRequest r in writesTo(table))
          if (r.method == 'POST' || r.method == 'PATCH') ...r.rows,
      ];

  Future<http.Response> _handle(http.Request request) async {
    requests.add(RecordedRequest(request.method, request.url, request.headers, request.bodyBytes));
    if (offline) throw const SocketException('Failed host lookup: fake.supabase.local');
    final RecordedRequest recorded = requests.last;
    final Map<String, dynamic>? failure = failures[recorded.target];
    if (failure != null && request.method != 'GET') {
      return http.Response(jsonEncode(failure), 400,
          request: request, headers: <String, String>{'content-type': 'application/json'});
    }
    if (recorded.service == 'storage') {
      return http.Response(
        jsonEncode(<String, dynamic>{'Key': '${recorded.target}/x', 'Id': 'obj'}),
        200,
        request: request,
        headers: <String, String>{'content-type': 'application/json'},
      );
    }
    if (request.method == 'GET') {
      // UTF-8 bytes: rows hold non-Latin text such as "JEE Main — Session 1".
      return http.Response.bytes(
        utf8.encode(jsonEncode(tables[recorded.target] ?? const <Map<String, dynamic>>[])),
        200,
        request: request,
        headers: <String, String>{'content-type': 'application/json; charset=utf-8'},
      );
    }
    if (request.method == 'POST' || request.method == 'PATCH') {
      final String? clash = _store(recorded.target, recorded.rows);
      if (clash != null) {
        return http.Response(
          jsonEncode(postgrestError('23505', 'duplicate key value violates unique constraint "$clash"')),
          409,
          request: request,
          headers: <String, String>{'content-type': 'application/json'},
        );
      }
    } else if (request.method == 'DELETE') {
      _remove(recorded.target, recorded.url.queryParameters);
    }
    return http.Response('', request.method == 'POST' ? 201 : 204, request: request);
  }

  /// The live database's UNIQUE constraints besides the primary key (from the schema).
  static const Map<String, List<List<String>>> uniqueKeys = <String, List<List<String>>>{
    'profiles': <List<String>>[
      <String>['user_id']
    ],
    'app_settings': <List<String>>[
      <String>['user_id']
    ],
    'chapters': <List<String>>[
      <String>['user_id', 'subject', 'name']
    ],
    'chapter_revisions': <List<String>>[
      <String>['chapter_id', 'revision_number']
    ],
    'test_subject_scores': <List<String>>[
      <String>['test_id', 'subject']
    ],
    'test_chapter_links': <List<String>>[
      <String>['test_id', 'chapter_id']
    ],
    'pyq_records': <List<String>>[
      <String>['chapter_id', 'exam', 'year']
    ],
    'chapter_stages': <List<String>>[
      <String>['chapter_id', 'stage']
    ],
    'user_exam_tracks': <List<String>>[
      <String>['user_id', 'track']
    ],
  };

  /// Applies an upsert like PostgREST (merge on `id`) and enforces the UNIQUE keys, so a
  /// reload sees what the server would hold. Returns the violated constraint, if any.
  String? _store(String table, List<Map<String, dynamic>> rows) {
    final List<Map<String, dynamic>> current = <Map<String, dynamic>>[...?tables[table]];
    for (final Map<String, dynamic> row in rows) {
      for (final List<String> key in uniqueKeys[table] ?? const <List<String>>[]) {
        final bool clash = current.any((Map<String, dynamic> other) =>
            other['id'] != row['id'] && key.every((String column) => other[column] == row[column]));
        if (clash) return '${table}_${key.join('_')}_key';
      }
      final int at = current.indexWhere((Map<String, dynamic> other) => other['id'] == row['id']);
      if (at >= 0) {
        current[at] = <String, dynamic>{...current[at], ...row};
      } else {
        // Server-side defaults the app leaves out of its payloads.
        current.add(<String, dynamic>{
          'created_at': '2026-10-25T10:00:00Z',
          'updated_at': '2026-10-25T10:00:00Z',
          ...row,
        });
      }
    }
    tables[table] = current;
    return null;
  }

  void _remove(String table, Map<String, String> filters) {
    final Map<String, String> equal = <String, String>{
      for (final MapEntry<String, String> f in filters.entries)
        if (f.value.startsWith('eq.')) f.key: f.value.substring(3),
    };
    // PostgREST `in.(a,b)` filters (values may be double-quoted).
    final Map<String, Set<String>> within = <String, Set<String>>{
      for (final MapEntry<String, String> f in filters.entries)
        if (f.value.startsWith('in.(') && f.value.endsWith(')'))
          f.key: f.value
              .substring(4, f.value.length - 1)
              .split(',')
              .map((String v) => v.replaceAll('"', '').trim())
              .toSet(),
    };
    bool matches(Map<String, dynamic> row) =>
        equal.entries.every((MapEntry<String, String> f) => '${row[f.key]}' == f.value) &&
        within.entries.every((MapEntry<String, Set<String>> f) => f.value.contains('${row[f.key]}'));
    tables[table] = <Map<String, dynamic>>[
      for (final Map<String, dynamic> row in tables[table] ?? const <Map<String, dynamic>>[])
        if (!matches(row)) row,
    ];
  }

  /// Every row this backend was sent, checked against the live schema.
  void expectAllWritesFit(SchemaSnapshot schema) {
    for (final RecordedRequest r in requests) {
      if (r.service != 'rest' || (r.method != 'POST' && r.method != 'PATCH')) continue;
      for (final Map<String, dynamic> row in r.rows) {
        expectFitsSchema(schema, r.target, row);
      }
    }
  }
}

/// A PostgREST error body, as the server sends it for a failed write.
Map<String, dynamic> postgrestError(String code, String message) =>
    <String, dynamic>{'code': code, 'message': message, 'details': null, 'hint': null};

/// The live database's columns and CHECK constraints (read-only snapshot from the Stracker
/// Supabase project, in test/fixtures/stracker_schema.json).
class SchemaSnapshot {
  SchemaSnapshot._(this.columns, this.checks);

  factory SchemaSnapshot.load() {
    final Map<String, dynamic> raw =
        jsonDecode(File('test/fixtures/stracker_schema.json').readAsStringSync()) as Map<String, dynamic>;
    return SchemaSnapshot._(
      (raw['columns'] as Map<String, dynamic>).map(
        (String table, dynamic cols) => MapEntry<String, Map<String, dynamic>>(table, cols as Map<String, dynamic>),
      ),
      (raw['checks'] as Map<String, dynamic>).map(
        (String table, dynamic list) => MapEntry<String, List<String>>(
          table,
          <String>[for (final dynamic c in list as List<dynamic>) (c as Map<String, dynamic>)['def'] as String],
        ),
      ),
    );
  }

  final Map<String, Map<String, dynamic>> columns;
  final Map<String, List<String>> checks;

  /// Problems with [row] for [table]: unknown columns, missing required columns, nulls in
  /// NOT NULL columns, values outside an enum list, text length and simple numeric bounds.
  List<String> problems(String table, Map<String, dynamic> row) {
    final Map<String, dynamic>? cols = columns[table];
    if (cols == null) return <String>['unknown table $table'];
    final List<String> out = <String>[];
    for (final String key in row.keys) {
      if (!cols.containsKey(key)) out.add('$table.$key is not a column');
    }
    cols.forEach((String name, dynamic meta) {
      final Map<String, dynamic> m = meta as Map<String, dynamic>;
      final bool required = m['nullable'] == false && m['default'] == null;
      if (required && !row.containsKey(name)) out.add('$table.$name is required but missing');
      if (row.containsKey(name) && row[name] == null && m['nullable'] == false) {
        out.add('$table.$name is NOT NULL but null was sent');
      }
    });
    for (final String check in checks[table] ?? const <String>[]) {
      final String? problem = _evaluate(check, row);
      if (problem != null) out.add('$table: $problem');
    }
    return out;
  }

  static final RegExp _enum = RegExp(r'\(?\(?(\w+) = ANY \(ARRAY\[([^\]]+)\]\)');
  static final RegExp _length = RegExp(r'char_length\((?:btrim\()?(\w+)\)?\) (>=|<=|>|<) (\d+)');
  static final RegExp _number = RegExp(r'\(\(?"?(\w+)"? (>=|<=|>|<) \(?(-?\d+(?:\.\d+)?)\)?(?:::numeric)?\)');

  /// Checks the parts of a CHECK it understands; null when it passes or cannot be judged.
  String? _evaluate(String check, Map<String, dynamic> row) {
    final bool nullable = check.contains(' IS NULL) OR');
    for (final RegExpMatch m in _enum.allMatches(check)) {
      final String col = m.group(1)!;
      if (!row.containsKey(col)) continue;
      final Object? value = row[col];
      if (value == null && nullable) continue;
      final List<String> allowed =
          RegExp(r"'([^']*)'").allMatches(m.group(2)!).map((RegExpMatch a) => a.group(1)!).toList();
      if (!allowed.contains(value)) return '$col=$value not in $allowed';
    }
    for (final RegExpMatch m in _length.allMatches(check)) {
      final String col = m.group(1)!;
      final Object? value = row[col];
      if (value is! String) continue;
      final int n = int.parse(m.group(3)!);
      final int len = m.group(0)!.contains('btrim') ? value.trim().length : value.length;
      if (!_compare(len, m.group(2)!, n)) return 'length of $col ($len) fails ${m.group(2)} $n';
    }
    if (check.contains('char_length') || check.contains('ANY') || check.contains('cardinality')) return null;
    for (final RegExpMatch m in _number.allMatches(check)) {
      final String col = m.group(1)!;
      final Object? value = row[col];
      if (value is! num) continue;
      final num n = num.parse(m.group(3)!);
      if (!_compare(value, m.group(2)!, n)) return '$col=$value fails ${m.group(2)} $n';
    }
    return null;
  }

  static bool _compare(num a, String op, num b) => switch (op) {
        '>=' => a >= b,
        '<=' => a <= b,
        '>' => a > b,
        '<' => a < b,
        _ => true,
      };
}

/// Fails the test when [row] does not fit the live schema of [table].
void expectFitsSchema(SchemaSnapshot schema, String table, Map<String, dynamic> row) {
  expect(schema.problems(table, row), isEmpty, reason: 'payload for $table: $row');
}
