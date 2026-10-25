import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';
import 'home_summary.dart' show indiaDate;

/// Planner rules ported from src/pages/PlannerPage.tsx, src/lib/task-validation.ts and
/// src/lib/goal-validation.ts.

class GoalTypeOption {
  const GoalTypeOption(this.type, this.title, this.unit);
  final String type;
  final String title;
  final String unit;
}

/// The only goal types the database accepts, with the website's default name and unit.
const List<GoalTypeOption> goalTypes = <GoalTypeOption>[
  GoalTypeOption('study_hours', 'Study hours', 'hours'),
  GoalTypeOption('tests', 'Tests', 'tests'),
  GoalTypeOption('chapters', 'Chapters', 'chapters'),
  GoalTypeOption('revisions', 'Revisions', 'revisions'),
  GoalTypeOption('custom', 'Custom goal', 'steps'),
];

const int maxCountGoal = 999999;
const int maxWeeklyStudyHours = 168;

/// "1h 5m" / "45m", the website's fmtDuration.
String fmtDuration(num minutes) {
  final int safe = minutes.round() < 0 ? 0 : minutes.round();
  final int hours = safe ~/ 60;
  final int mins = safe % 60;
  return hours > 0 ? '${hours}h ${mins}m' : '${mins}m';
}

/// Field errors for a task, keyed like the website ('title', 'topic', 'estimated_minutes',
/// 'task_date', 'chapter_id'). Empty when the task can be saved.
Map<String, String> taskProblems({
  required String title,
  required String topic,
  required String minutes,
  required String date,
  String? subject,
  String? chapterId,
  List<Chapter> chapters = const <Chapter>[],
}) {
  final Map<String, String> errors = <String, String>{};
  final String cleanTitle = title.trim();
  if (cleanTitle.isEmpty) {
    errors['title'] = 'Task title is required.';
  } else if (cleanTitle.length > 200) {
    errors['title'] = 'Keep the task under 200 characters.';
  }
  if (topic.trim().length > 120) errors['topic'] = 'Keep the topic under 120 characters.';
  final String m = minutes.trim();
  final int? parsed = int.tryParse(m);
  if (m.isEmpty) {
    errors['estimated_minutes'] = 'Enter the estimated minutes.';
  } else if (parsed == null) {
    errors['estimated_minutes'] = 'Use whole minutes.';
  } else if (parsed < 0 || parsed > 1440) {
    errors['estimated_minutes'] = 'Use 0 to 1440 minutes.';
  }
  if (parseIsoDate(date) == null) errors['task_date'] = 'Choose a valid date.';
  if (chapterId != null) {
    Chapter? chapter;
    for (final Chapter item in chapters) {
      if (item.id == chapterId) chapter = item;
    }
    if (chapter == null || (subject != null && chapter.subject != subject)) {
      errors['chapter_id'] = 'Choose a chapter that belongs to the selected subject.';
    }
  }
  return errors;
}

/// The website's topic hint, including the 120-character counter.
String topicHint(int length) {
  if (length >= 120) return '$length/120 characters — limit reached, extra text won’t be added.';
  if (length >= 100) return '$length/120 characters — nearly at the limit.';
  return 'Optional — e.g. Gauss’s law, or Integration by parts. $length/120';
}

/// First goal problem, keyed by field, or empty when valid.
Map<String, String> goalProblems({required String type, required String title, required String target}) {
  final Map<String, String> errors = <String, String>{};
  if (title.trim().isEmpty) {
    errors['title'] = 'Give the goal a name.';
  } else if (title.trim().length > 120) {
    errors['title'] = 'Keep the name under 120 characters.';
  }
  final double? value = double.tryParse(target.trim());
  if (value == null || !value.isFinite || value <= 0) {
    errors['target'] = 'Enter a target above zero.';
  } else if (type == 'study_hours') {
    if (value > maxWeeklyStudyHours) {
      errors['target'] = 'A weekly study-hours target cannot exceed 168 hours.';
    } else if (value * 2 != (value * 2).truncateToDouble()) {
      errors['target'] = 'Study-hours targets use half-hour increments.';
    }
  } else if (value != value.truncateToDouble() || value > maxCountGoal) {
    errors['target'] = 'Test, chapter, revision, and custom targets must be whole-number counts.';
  }
  return errors;
}

/// Live progress, like the website: study hours, tests, chapters and revisions come from
/// real activity in that week; only custom goals use the stored counter.
double goalProgress(WeeklyGoal goal, AppData data) {
  final String start = goal.weekStart;
  final String end = addDays(start, 6);
  bool inWeek(String? iso) => iso != null && iso.length >= 10 && iso.compareTo(start) >= 0 && iso.compareTo(end) <= 0;
  switch (goal.goalType) {
    case 'study_hours':
      return data.sessions
              .where((StudySession s) => inWeek(indiaDate(s.startedAt)))
              .fold<int>(0, (int sum, StudySession s) => sum + s.durationMinutes) /
          60;
    case 'tests':
      return data.tests.where((TestRecord t) => inWeek(t.testDate)).length.toDouble();
    case 'chapters':
      return data.chapters.where((Chapter c) => inWeek(c.completedOn)).length.toDouble();
    case 'revisions':
      return data.revisions
          .where((Revision r) => r.completedAt != null && inWeek(indiaDate(r.completedAt!)))
          .length
          .toDouble();
    default:
      return goal.progressValue;
  }
}
