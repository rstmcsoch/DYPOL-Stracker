/// Offline writes waiting to reach the cloud.
///
/// Every save is applied on the device first. When the cloud cannot be reached the
/// write is kept here, as the exact upserts and deletes it would have sent, and replayed
/// in order once the connection is back. Replaying is safe to repeat: rows are upserted
/// by id and deletes are tombstones by id (or by parent id), so a write that landed
/// before the connection dropped is simply written again with the same values.
class SyncOp {
  const SyncOp._({
    required this.kind,
    required this.table,
    this.rows = const <Map<String, dynamic>>[],
    this.ids = const <String>[],
    this.column,
    this.value,
    this.filePath,
  });

  /// Upsert [rows] into [table] (insert or update by id).
  factory SyncOp.upsert(String table, List<Map<String, dynamic>> rows) => SyncOp._(
        kind: upsertKind,
        table: table,
        rows: <Map<String, dynamic>>[for (final Map<String, dynamic> row in rows) Map<String, dynamic>.from(row)],
      );

  /// Delete the rows of [table] with these ids (a tombstone).
  factory SyncOp.delete(String table, List<String> ids) =>
      SyncOp._(kind: deleteKind, table: table, ids: List<String>.of(ids));

  /// Delete the rows of [table] whose [column] equals [value] (children of a deleted row).
  factory SyncOp.deleteWhere(String table, String column, String value) =>
      SyncOp._(kind: deleteWhereKind, table: table, column: column, value: value);

  /// Upload a mistake's photo kept on the device, then upsert the mistake [row] with the
  /// stored path. A photo that has gone missing saves the note without it.
  factory SyncOp.mistakeImage(Map<String, dynamic> row, String filePath) => SyncOp._(
        kind: mistakeImageKind,
        table: 'mistakes',
        rows: <Map<String, dynamic>>[Map<String, dynamic>.from(row)],
        filePath: filePath,
      );

  static const String upsertKind = 'upsert';
  static const String deleteKind = 'delete';
  static const String deleteWhereKind = 'delete_where';
  static const String mistakeImageKind = 'mistake_image';

  final String kind;
  final String table;
  final List<Map<String, dynamic>> rows;
  final List<String> ids;
  final String? column;
  final String? value;
  final String? filePath;

  /// Ids of the upserted rows (empty for deletes).
  Set<String> get rowIds => <String>{for (final Map<String, dynamic> row in rows) '${row['id']}'};

  Map<String, dynamic> toJson() => <String, dynamic>{
        'kind': kind,
        'table': table,
        if (rows.isNotEmpty) 'rows': rows,
        if (ids.isNotEmpty) 'ids': ids,
        if (column != null) 'column': column,
        if (value != null) 'value': value,
        if (filePath != null) 'file': filePath,
      };

  static SyncOp? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final Object? kind = raw['kind'];
    final Object? table = raw['table'];
    if (kind is! String || table is! String || table.isEmpty) return null;
    final Object? rows = raw['rows'];
    final Object? ids = raw['ids'];
    final List<Map<String, dynamic>> rowList = <Map<String, dynamic>>[
      if (rows is List)
        for (final Object? row in rows)
          if (row is Map) Map<String, dynamic>.from(row),
    ];
    final List<String> idList = <String>[
      if (ids is List)
        for (final Object? id in ids)
          if (id is String) id,
    ];
    switch (kind) {
      case upsertKind:
        return rowList.isEmpty ? null : SyncOp.upsert(table, rowList);
      case deleteKind:
        return idList.isEmpty ? null : SyncOp.delete(table, idList);
      case deleteWhereKind:
        final Object? column = raw['column'];
        final Object? value = raw['value'];
        if (column is! String || value is! String) return null;
        return SyncOp.deleteWhere(table, column, value);
      case mistakeImageKind:
        final Object? file = raw['file'];
        if (rowList.isEmpty || file is! String) return null;
        return SyncOp.mistakeImage(rowList.first, file);
    }
    return null;
  }
}

/// Adds [op] to [queue], folding it into the previous write when that one only upserted
/// the same rows of the same table (repeated edits of one item send one request).
List<SyncOp> enqueueSyncOp(List<SyncOp> queue, SyncOp op) {
  if (queue.isNotEmpty && op.kind == SyncOp.upsertKind) {
    final SyncOp last = queue.last;
    if (last.kind == SyncOp.upsertKind && last.table == op.table && op.rowIds.containsAll(last.rowIds)) {
      return <SyncOp>[...queue.sublist(0, queue.length - 1), op];
    }
  }
  return <SyncOp>[...queue, op];
}

/// Wait before the next automatic retry: 2 s, doubling to at most a minute.
Duration syncRetryDelay(int attempt) {
  final int seconds = 2 << (attempt.clamp(0, 5));
  return Duration(seconds: seconds > 60 ? 60 : seconds);
}
