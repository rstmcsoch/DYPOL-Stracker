import '../data/app_data.dart';
import '../data/models.dart';
import 'analytics.dart';

/// Mock deep-dive: time and attempts per subject, lost-mark classification, and the
/// derived "fix before your next mock" insights (src/lib/jee/mock-analysis.ts).
class CategoryLoss {
  const CategoryLoss({
    required this.category,
    required this.marksLost,
    required this.questions,
    required this.entries,
  });

  final String category;
  final double marksLost;
  final int questions;
  final int entries;
}

class SubjectTime {
  const SubjectTime({
    required this.subject,
    required this.minutes,
    required this.attempted,
    required this.unattempted,
  });

  final String subject;
  final int minutes;
  final int attempted;
  final int unattempted;
}

class MockAnalysis {
  const MockAnalysis({
    required this.test,
    required this.percentage,
    required this.byCategory,
    required this.bySubject,
    required this.totalLost,
    required this.insights,
  });

  final TestRecord test;
  final double? percentage;
  final List<CategoryLoss> byCategory;
  final List<SubjectTime> bySubject;
  final double totalLost;
  final List<String> insights;

  bool get isEmpty => byCategory.isEmpty && bySubject.isEmpty;
}

MockAnalysis analyseMock(AppData data, TestRecord test) {
  final List<TestErrorLog> errors =
      data.errorLogs.where((TestErrorLog log) => log.testId == test.id).toList();
  final Map<String, ({double marks, int questions, int entries})> grouped =
      <String, ({double marks, int questions, int entries})>{};
  for (final TestErrorLog log in errors) {
    final ({double marks, int questions, int entries}) current =
        grouped[log.category] ?? (marks: 0, questions: 0, entries: 0);
    grouped[log.category] = (
      marks: current.marks + (log.marksLost ?? 0),
      questions: current.questions + (log.questions ?? 0),
      entries: current.entries + 1,
    );
  }
  final List<CategoryLoss> byCategory = <CategoryLoss>[
    for (final MapEntry<String, ({double marks, int questions, int entries})> entry in grouped.entries)
      CategoryLoss(
        category: entry.key,
        marksLost: entry.value.marks,
        questions: entry.value.questions,
        entries: entry.value.entries,
      ),
  ]..sort((CategoryLoss a, CategoryLoss b) => b.marksLost.compareTo(a.marksLost));

  final Map<String, ({int minutes, int attempted, int unattempted})> subjectTotals =
      <String, ({int minutes, int attempted, int unattempted})>{};
  for (final TestTimeEntry entry in data.timeEntries.where((TestTimeEntry row) => row.testId == test.id)) {
    final String key = entry.subject ?? entry.label;
    final ({int minutes, int attempted, int unattempted}) current =
        subjectTotals[key] ?? (minutes: 0, attempted: 0, unattempted: 0);
    subjectTotals[key] = (
      minutes: current.minutes + (entry.minutes ?? 0),
      attempted: current.attempted + (entry.attempted ?? 0),
      unattempted: current.unattempted + (entry.unattempted ?? 0),
    );
  }
  final List<SubjectTime> bySubject = <SubjectTime>[
    for (final MapEntry<String, ({int minutes, int attempted, int unattempted})> entry
        in subjectTotals.entries)
      SubjectTime(
        subject: entry.key,
        minutes: entry.value.minutes,
        attempted: entry.value.attempted,
        unattempted: entry.value.unattempted,
      ),
  ];

  final double totalLost = byCategory.fold<double>(0, (double acc, CategoryLoss item) => acc + item.marksLost);
  final List<String> insights = <String>[];
  if (byCategory.isNotEmpty) {
    final CategoryLoss top = byCategory.first;
    insights.add('Biggest loss: ${top.category} — ${top.marksLost.toStringAsFixed(1)} marks across '
        '${top.entries} entr${top.entries == 1 ? 'y' : 'ies'}. Fix this before your next mock.');
    final CategoryLoss? silly = _firstWhere(
      byCategory,
      (CategoryLoss item) => item.category == 'Silly mistake' || item.category == 'Misread question',
    );
    if (silly != null && silly.marksLost > 0) {
      insights.add('${silly.marksLost.toStringAsFixed(1)} marks were avoidable (${silly.category}) — '
          'slow down on the first read rather than adding practice volume.');
    }
    final CategoryLoss? concept =
        _firstWhere(byCategory, (CategoryLoss item) => item.category == 'Concept gap');
    if (concept != null && concept.marksLost > 0) {
      insights.add('${concept.marksLost.toStringAsFixed(1)} marks came from concept gaps — revise those '
          'chapters before the next test.');
    }
  }
  final int totalMinutes = bySubject.fold<int>(0, (int acc, SubjectTime item) => acc + item.minutes);
  if (bySubject.length >= 2 && totalMinutes > 0) {
    final List<SubjectTime> sorted = List<SubjectTime>.from(bySubject)
      ..sort((SubjectTime a, SubjectTime b) => b.minutes.compareTo(a.minutes));
    insights.add('${sorted.first.subject} took ${sorted.first.minutes} min '
        '(${(sorted.first.minutes / totalMinutes * 100).toStringAsFixed(0)}% of the paper) — '
        'check whether that is where the marks went.');
  }
  if (insights.isEmpty) {
    insights.add('No error log or timing recorded for this test yet. Add what went wrong to get an insight.');
  }

  return MockAnalysis(
    test: test,
    percentage: overallTestPercentage(test, data.testSubjectScores),
    byCategory: byCategory,
    bySubject: bySubject,
    totalLost: totalLost,
    insights: insights,
  );
}

List<TestRecord> mockTests(AppData data) => data.tests
    .where((TestRecord test) => test.testType == 'Full Mock')
    .toList()
  ..sort((TestRecord a, TestRecord b) => b.testDate.compareTo(a.testDate));

T? _firstWhere<T>(List<T> values, bool Function(T value) test) {
  for (final T value in values) {
    if (test(value)) return value;
  }
  return null;
}
