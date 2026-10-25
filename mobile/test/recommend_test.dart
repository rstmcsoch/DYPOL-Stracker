import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/recommend.dart';

const String today = '2026-01-10';

Chapter chapter(String id, String name) => Chapter(
      id: id,
      userId: 'u1',
      subject: 'Physics',
      name: name,
      status: 'Studying',
    );

void main() {
  test('an empty notebook explains itself instead of inventing work', () {
    final AppData data = AppData(userId: 'u1', settings: AppSettings.defaults('u1'));
    final StudyNowResult result = recommendStudyNow(data, today);
    expect(result.primary, isNull);
    expect(result.alternatives, isEmpty);
    expect(result.emptyReason, isNotNull);
  });

  test('an overdue revision is the top suggestion', () {
    final AppData data = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      chapters: <Chapter>[chapter('c1', 'Rotational Motion')],
      revisions: <Revision>[
        Revision(id: 'r1', userId: 'u1', chapterId: 'c1', revisionNumber: 1, dueOn: '2026-01-04'),
      ],
    );
    final StudyNowResult result = recommendStudyNow(data, today);
    expect(result.primary, isNotNull);
    expect(result.primary!.kind, 'revision');
    expect(result.primary!.chapterId, 'c1');
    expect(result.primary!.route, isNotEmpty);
    expect(result.primary!.reasons, isNotEmpty);
    expect(result.alternatives.length, lessThanOrEqualTo(4));
  });

  test('an overdue active backlog item is suggested and snoozing hides it', () {
    BacklogItem item(String status, String? snoozed) => BacklogItem(
          id: 'b1',
          userId: 'u1',
          title: 'Finish thermodynamics DPP',
          priority: 'high',
          dueOn: '2026-01-05',
          status: status,
          snoozedUntil: snoozed,
        );

    expect(isBacklogAwake(item('active', null), today), isTrue);
    expect(isBacklogAwake(item('snoozed', '2026-02-01'), today), isFalse);
    // Website isAwake: a snoozed item comes back on its date.
    expect(isBacklogAwake(item('snoozed', today), today), isTrue);
    expect(isBacklogAwake(item('done', null), today), isFalse);

    final AppData data = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      backlogItems: <BacklogItem>[item('active', null)],
    );
    final StudyNowResult result = recommendStudyNow(data, today);
    expect(result.primary, isNotNull);
    expect(result.primary!.kind, 'backlog');
  });

  test('the ranking is deterministic for the same day', () {
    final AppData data = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      chapters: <Chapter>[chapter('c1', 'Optics'), chapter('c2', 'Waves')],
      revisions: <Revision>[
        Revision(id: 'r1', userId: 'u1', chapterId: 'c1', revisionNumber: 1, dueOn: '2026-01-01'),
        Revision(id: 'r2', userId: 'u1', chapterId: 'c2', revisionNumber: 1, dueOn: '2026-01-02'),
      ],
    );
    final StudyNowResult a = recommendStudyNow(data, today);
    final StudyNowResult b = recommendStudyNow(data, today);
    expect(a.primary!.id, b.primary!.id);
    expect(a.primary!.score, b.primary!.score);
  });
}
