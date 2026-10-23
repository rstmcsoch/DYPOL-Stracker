import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/revision.dart';

AppData notebook(List<Revision> revisions) => AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      revisions: revisions,
    );

Revision revision(String id, String due, {int number = 1, String? completedAt}) => Revision(
      id: id,
      userId: 'u1',
      chapterId: 'c1',
      revisionNumber: number,
      dueOn: due,
      completedAt: completedAt,
    );

void main() {
  test('buckets split overdue, today and upcoming without losing any', () {
    final AppData data = notebook(<Revision>[
      revision('r1', '2026-01-01'),
      revision('r2', '2026-01-10', number: 2),
      revision('r3', '2026-02-01', number: 3),
      revision('r4', '2025-12-01', completedAt: '2025-12-01'),
    ]);
    final RevisionBuckets buckets = revisionBuckets(data, today: '2026-01-10');
    expect(buckets.overdue.map((Revision r) => r.id), <String>['r1']);
    expect(buckets.today.map((Revision r) => r.id), <String>['r2']);
    expect(buckets.upcoming.map((Revision r) => r.id), <String>['r3']);
    expect(buckets.openCount, 3);
    expect(buckets.isEmpty, isFalse);
  });

  test('the ladder follows the account gap list', () {
    final AppData data = notebook(<Revision>[]);
    final Revision first = startRevisionChain(data, 'c1');
    expect(first.revisionNumber, 1);
    expect(first.chapterId, 'c1');

    Revision current = revision('r1', '2026-01-01', number: 1);
    for (int step = 2; step <= 3; step++) {
      final Revision? next = nextRevision(data: data, completed: current);
      expect(next, isNotNull, reason: 'gap list has three rungs');
      expect(next!.revisionNumber, step);
      current = next;
    }
    // R30 is the last rung: no fourth revision is scheduled.
    expect(nextRevision(data: data, completed: current), isNull);
  });

  test('an empty ladder schedules nothing', () {
    final AppData data = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1').copyWith(revisionGaps: const <int>[]),
    );
    expect(nextRevision(data: data, completed: revision('r1', '2026-01-01')), isNull);
  });
}
