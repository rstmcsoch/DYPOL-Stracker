import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/logic/planner.dart';

WeeklyGoal goal(String type, {double target = 10, double progress = 0}) => WeeklyGoal(
      id: 'g-$type',
      userId: 'u1',
      goalType: type,
      title: type,
      target: target,
      progressValue: progress,
      weekStart: '2026-10-19',
      unit: 'x',
    );

void main() {
  test('goal types are exactly the ones the database accepts', () {
    expect(goalTypes.map((GoalTypeOption o) => o.type).toList(),
        <String>['study_hours', 'tests', 'chapters', 'revisions', 'custom']);
    expect(goalTypes.first.unit, 'hours');
    expect(goalTypes.last.unit, 'steps');
  });

  test('goal validation follows the website messages', () {
    expect(goalProblems(type: 'study_hours', title: ' ', target: '10')['title'], 'Give the goal a name.');
    expect(goalProblems(type: 'study_hours', title: 'a', target: '169')['target'],
        'A weekly study-hours target cannot exceed 168 hours.');
    expect(goalProblems(type: 'study_hours', title: 'a', target: '2.3')['target'],
        'Study-hours targets use half-hour increments.');
    expect(goalProblems(type: 'study_hours', title: 'a', target: '2.5'), isEmpty);
    expect(goalProblems(type: 'tests', title: 'a', target: '2.5')['target'],
        'Test, chapter, revision, and custom targets must be whole-number counts.');
    expect(goalProblems(type: 'custom', title: 'a', target: '0')['target'], isNotNull);
    expect(goalProblems(type: 'custom', title: 'a', target: '7'), isEmpty);
  });

  test('task validation matches taskInputSchema and the chapter rule', () {
    final Map<String, String> bad = taskProblems(title: '  ', topic: 'x' * 121, minutes: '1441', date: 'nope');
    expect(bad['title'], 'Task title is required.');
    expect(bad['topic'], 'Keep the topic under 120 characters.');
    expect(bad['estimated_minutes'], isNotNull);
    expect(bad['task_date'], isNotNull);
    const Chapter chapter = Chapter(id: 'c1', userId: 'u1', subject: 'Physics', name: 'Optics');
    expect(
      taskProblems(
          title: 'a', topic: '', minutes: '0', date: '2026-10-25', subject: 'Maths', chapterId: 'c1',
          chapters: <Chapter>[chapter])['chapter_id'],
      'Choose a chapter that belongs to the selected subject.',
    );
    expect(
      taskProblems(
          title: 'a', topic: '', minutes: '30', date: '2026-10-25', subject: 'Physics', chapterId: 'c1',
          chapters: <Chapter>[chapter]),
      isEmpty,
    );
  });

  test('topic counter hint has the three website states', () {
    expect(topicHint(5), 'Optional — e.g. Gauss’s law, or Integration by parts. 5/120');
    expect(topicHint(100), '100/120 characters — nearly at the limit.');
    expect(topicHint(120), '120/120 characters — limit reached, extra text won’t be added.');
  });

  test('goal progress comes from real activity inside the IST week', () {
    final AppData data = AppData.empty('u1').copyWith(
      sessions: const <StudySession>[
        // 23:50 IST Sunday 25 Oct (in week) and 00:10 IST Monday 26 Oct (next week).
        StudySession(id: 's1', userId: 'u1', startedAt: '2026-10-25T18:20:00.000Z', durationMinutes: 90),
        StudySession(id: 's2', userId: 'u1', startedAt: '2026-10-25T18:40:00.000Z', durationMinutes: 60),
      ],
      revisions: const <Revision>[
        Revision(id: 'r1', userId: 'u1', chapterId: 'c', revisionNumber: 1, dueOn: '2026-10-20',
            completedAt: '2026-10-20T05:00:00.000Z'),
        Revision(id: 'r2', userId: 'u1', chapterId: 'c', revisionNumber: 2, dueOn: '2026-10-20'),
      ],
    );
    expect(goalProgress(goal('study_hours'), data), 1.5);
    expect(goalProgress(goal('revisions'), data), 1);
    expect(goalProgress(goal('custom', progress: 3), data), 3);
    expect(fmtDuration(60), '1h 0m');
    expect(fmtDuration(45), '45m');
  });
}
