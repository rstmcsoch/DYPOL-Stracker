import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/app_data_codec.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/backup.dart';

AppData sample() {
  return AppData(
    userId: 'user-1',
    settings: AppSettings.defaults('user-1').copyWith(
      ownerName: 'Rustam',
      targetScore: 250,
      revisionGaps: const <int>[1, 7, 30],
    ),
    profile: const Profile(id: 'user-1', userId: 'user-1', displayName: 'Rustam', email: 'r@example.com'),
    chapters: <Chapter>[
      const Chapter(id: 'c1', userId: 'user-1', subject: 'Physics', name: 'Kinematics', status: 'Done', position: 0),
      const Chapter(id: 'c2', userId: 'user-1', subject: 'Maths', name: 'Calculus', status: 'Studying', position: 1),
    ],
    tests: <TestRecord>[
      const TestRecord(
        id: 't1',
        userId: 'user-1',
        title: 'Kinematics test',
        testDate: '2026-01-05',
        testType: 'Chapter Test',
        chapterId: 'c1',
        marksObtained: 42,
        totalMarks: 80,
      ),
    ],
    mistakes: <Mistake>[
      const Mistake(
        id: 'm1',
        userId: 'user-1',
        chapterId: 'c1',
        mistakeType: 'Conceptual',
        questionNote: 'Relative velocity sign',
        retryLater: true,
        retryStatus: 'pending',
      ),
    ],
    revisions: <Revision>[
      const Revision(id: 'r1', userId: 'user-1', chapterId: 'c1', revisionNumber: 1, dueOn: '2026-01-12'),
    ],
  );
}

void main() {
  test('the whole notebook survives a JSON round trip', () {
    final AppData original = sample();
    final String encoded = AppDataCodec.encode(original);
    final AppData? restored = AppDataCodec.decode(encoded, 'user-1');
    expect(restored, isNotNull);

    final AppData data = restored!;
    expect(data.chapters.length, 2);
    expect(data.chapters.first.name, 'Kinematics');
    expect(data.settings.targetScore, 250);
    expect(data.settings.ownerName, 'Rustam');
    expect(data.tests.single.marksObtained, 42);
    expect(data.mistakes.single.retryStatus, 'pending');
    expect(data.revisions.single.dueOn, '2026-01-12');
    expect(data.profile?.displayName, 'Rustam');
  });

  test('a backup file is valid JSON with the documented tables', () {
    final Map<String, dynamic> payload = buildBackupPayload(sample(), exportedAt: '2026-01-10T00:00:00.000Z');
    expect(payload['format'], 'stracker-json');
    expect(payload['exported_at'], '2026-01-10T00:00:00.000Z');
    expect(backupCounts(payload)['chapters'], 2);
    expect(backupCounts(payload)['tests'], 1);
    expect(backupRowTotal(payload), greaterThanOrEqualTo(4));
  });

  test('importing rejects junk with a readable message', () {
    expect(() => parseBackupText(''), throwsA(isA<Exception>()));
    expect(() => parseBackupText('not json'), throwsA(isA<Exception>()));
    expect(() => parseBackupText('[1,2,3]'), throwsA(isA<Exception>()));
    expect(() => parseBackupText('{"nothing": []}'), throwsA(isA<Exception>()));
    expect(
      () => parseBackupText('{"chapters": [], "version": 99}'),
      throwsA(isA<Exception>()),
    );
  });

  test('CSV export escapes commas and quotes', () {
    final Map<String, String> csvs = backupCsvs(sample());
    expect(csvs.keys, contains('chapters'));
    expect(csvs['chapters']!.split('\n').first, startsWith('id,subject,name'));
    expect(csvs['chapters']!.split('\n').length, 3);
  });
}
