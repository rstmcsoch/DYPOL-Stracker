import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/analytics.dart';
import 'package:stracker/logic/recommend.dart';

const String today = '2026-01-10';

Chapter chapter(String id) => Chapter(id: id, userId: 'u1', subject: 'Physics', name: 'Chapter $id', status: 'Studying');

TestRecord record(String id, {String? chapterId, double? marks, double? total, String date = today}) => TestRecord(
      id: id,
      userId: 'u1',
      title: 'Test $id',
      testDate: date,
      testType: 'Chapter Test',
      subject: 'Physics',
      chapterId: chapterId,
      marksObtained: marks,
      totalMarks: total,
    );

void main() {
  test('saving a test without a score still removes its chapter from the untested list', () {
    final AppData before = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      chapters: <Chapter>[chapter('c1'), chapter('c2'), chapter('c3')],
    );
    expect(untestedChapters(before), hasLength(3));
    final AppData after = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      chapters: before.chapters,
      tests: <TestRecord>[record('t1', chapterId: 'c1'), record('t2')],
      testChapterLinks: const <TestChapterLink>[
        TestChapterLink(id: 'l1', userId: 'u1', testId: 't2', chapterId: 'c2'),
      ],
    );
    expect(untestedChapters(after).map((ChapterPerformance row) => row.chapter.id), <String>['c3']);
  });

  test('the empty recommendation acknowledges a test logged today', () {
    final AppData withTest = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      tests: <TestRecord>[record('t1')],
    );
    expect(recommendStudyNow(withTest, today).emptyReason, contains('test is logged'));
    final AppData olderTest = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      tests: <TestRecord>[record('t1', date: '2026-01-01')],
    );
    expect(recommendStudyNow(olderTest, today).emptyReason, contains('Log a test'));
  });
}
