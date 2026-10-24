import 'package:stracker/data/models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/validators.dart';

void main() {
  test('email and password rules match the auth screens', () {
    expect(Validators.email('rustam@example.com'), isNull);
    expect(Validators.email('nope'), isNotNull);
    expect(Validators.email(''), isNotNull);
    expect(Validators.password('short'), isNotNull);
    expect(Validators.password('longenough'), isNull);
    expect(Validators.confirmPassword('a', 'b'), isNotNull);
    expect(Validators.confirmPassword('same', 'same'), isNull);
  });

  test('practice counts stay consistent', () {
    expect(Validators.practiceCounts(attempted: 20, correct: 12, incorrect: 5), isNull);
    expect(Validators.practiceCounts(attempted: 20, correct: 12, incorrect: 9), isNotNull);
    expect(Validators.practiceCounts(attempted: -1, correct: 0, incorrect: 0), isNotNull);
    expect(Validators.practiceCounts(attempted: 100001, correct: 0, incorrect: 0), isNotNull);
  });

  test('marks accept half points and whole totals', () {
    expect(Validators.marksObtained('48.5'), isNull);
    expect(Validators.marksObtained('48.25'), isNotNull);
    expect(Validators.marksObtained('-1'), isNotNull);
    expect(Validators.totalMarks('100'), isNull);
    expect(Validators.totalMarks('100.5'), isNotNull);
    expect(Validators.totalMarks('0'), isNotNull);
    expect(Validators.scorePair(42, 80), isNull);
    expect(Validators.scorePair(90, 80), isNotNull);
    expect(Validators.scorePair(42, null), isNotNull);
    expect(Validators.scorePair(null, 80), isNull);
  });

  test('negative marks use quarter steps', () {
    expect(Validators.negativeMarks('1.25'), isNull);
    expect(Validators.negativeMarks('1.3'), isNotNull);
    expect(Validators.negativeMarks('-1'), isNotNull);
  });

  test('settings values stay in range', () {
    expect(Validators.thresholds(60, 80, 10), isNull);
    expect(Validators.thresholds(85, 80, 10), isNotNull);
    expect(Validators.thresholds(0, 101, 10), isNotNull);
    expect(Validators.weights(2, 1, 0.5), isNull);
    expect(Validators.weights(0, 1, 0.5), isNotNull);
    expect(Validators.years(2019, 2026), isNull);
    expect(Validators.years(2026, 2019), isNotNull);
    expect(Validators.revisionGaps('1, 7, 30'), isNull);
    expect(Validators.revisionGaps('1, 0, 30'), isNotNull);
    expect(Validators.revisionGaps(''), isNotNull);
    expect(Validators.reminderTime('08:00'), isNull);
    expect(Validators.reminderTime('24:00'), isNotNull);
    expect(Validators.reminderTime('8:00'), isNotNull);
    expect(Validators.minutes('90'), isNull);
    expect(Validators.minutes('1500'), isNotNull);
    expect(Validators.date('2026-01-10'), isNull);
    expect(Validators.date('10/01/2026'), isNotNull);
    expect(Validators.name('x' * 161), isNotNull);
    expect(Validators.name('Kinematics'), isNull);
  });

  test('practice incorrect is derived from attempted − correct', () {
    expect(Validators.derivedIncorrect('120', '92'), 28);
    expect(Validators.derivedIncorrect('10', '10'), 0);
    expect(Validators.derivedIncorrect('10', '12'), isNull);
    expect(Validators.derivedIncorrect('', '3'), isNull);
    expect(Validators.practiceCorrect(attempted: 10, correct: 12), contains('can’t be more than attempted'));
    expect(Validators.practiceCorrect(attempted: 10, correct: 7), isNull);
  });

  test('planner tasks carry an optional topic and old rows still load', () {
    final DailyTask legacy = DailyTask.fromMap(<String, dynamic>{'id': 't', 'user_id': 'u', 'title': 'Revise', 'task_date': '2026-10-08'});
    expect(legacy.topic, isNull);
    final DailyTask withTopic = DailyTask.fromMap(<String, dynamic>{...legacy.toMap(), 'topic': 'Gauss’s law'});
    expect(withTopic.topic, 'Gauss’s law');
    expect(withTopic.copyWith(isCompleted: true).toMap()['topic'], 'Gauss’s law');
  });

  test('question counts never exceed the test total', () {
    expect(Validators.questionCounts(30, 30, 30, 50), contains('(90)'));
    expect(Validators.questionCounts(30, 15, 5, 50), isNull);
    expect(Validators.questionCounts(30, 30, 30, null), isNull);
    expect(Validators.questionCounts(null, null, null, 0), isNotNull);
    final TestRecord test = TestRecord.fromMap(<String, dynamic>{'id': 't', 'title': 'T', 'total_questions': 50});
    expect(test.totalQuestions, 50);
    expect(test.toMap()['total_questions'], 50);
  });
}
