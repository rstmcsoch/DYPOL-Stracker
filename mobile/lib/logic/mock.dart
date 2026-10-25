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

/* ------------------------------------------------------------------ */
/* Website mock-analysis.ts, field for field                           */

/// JavaScript's String(number): 16 rather than 16.0.
String jsNumberText(num value) =>
    value is int || value == value.truncateToDouble() ? value.round().toString() : value.toString();

class CategoryTotal {
  const CategoryTotal({required this.category, required this.entries, this.marksLost, this.questions});

  final String category;
  final int entries;
  final double? marksLost;
  final int? questions;
}

/// `categoryTotals`: per category in the website's order; null when no row recorded the value.
List<CategoryTotal> categoryTotals(List<TestErrorLog> logs) => <CategoryTotal>[
      for (final String category in errorCategories)
        if (logs.any((TestErrorLog log) => log.category == category))
          () {
            final List<TestErrorLog> rows = logs.where((TestErrorLog log) => log.category == category).toList();
            final List<TestErrorLog> marks = rows.where((TestErrorLog row) => row.marksLost != null).toList();
            final List<TestErrorLog> questions = rows.where((TestErrorLog row) => row.questions != null).toList();
            return CategoryTotal(
              category: category,
              entries: rows.length,
              marksLost: marks.isEmpty ? null : marks.fold<double>(0, (double sum, TestErrorLog r) => sum + r.marksLost!),
              questions: questions.isEmpty ? null : questions.fold<int>(0, (int sum, TestErrorLog r) => sum + r.questions!),
            );
          }(),
    ];

class SubjectTimeRow {
  const SubjectTimeRow({
    required this.subject,
    this.minutes,
    this.attempted,
    this.unattempted,
    this.marks,
    this.total,
    this.marksPerMinute,
  });

  final String subject;
  final int? minutes;
  final int? attempted;
  final int? unattempted;
  final double? marks;
  final double? total;
  final double? marksPerMinute;
}

/// `subjectTimeRows`: recorded time and attempts per subject, joined with the subject's
/// recorded marks. Subjects with nothing recorded are left out.
List<SubjectTimeRow> subjectTimeRows(TestRecord test, AppData data) {
  final List<TestTimeEntry> entries = data.timeEntries.where((TestTimeEntry e) => e.testId == test.id).toList();
  final List<TestSubjectScore> scores =
      data.testSubjectScores.where((TestSubjectScore s) => s.testId == test.id).toList();
  final List<String> subjects = <String>[];
  for (final String? subject in <String?>[
    ...examSubjectNames(data),
    ...entries.map((TestTimeEntry e) => e.subject),
    ...scores.map((TestSubjectScore s) => s.subject),
  ]) {
    if (subject != null && subject.isNotEmpty && !subjects.contains(subject)) subjects.add(subject);
  }
  int? sum(List<int?> values) {
    final List<int> present = <int>[
      for (final int? v in values)
        if (v != null) v,
    ];
    return present.isEmpty ? null : present.fold<int>(0, (int a, int b) => a + b);
  }

  final List<SubjectTimeRow> rows = <SubjectTimeRow>[];
  for (final String subject in subjects) {
    final List<TestTimeEntry> mine = entries.where((TestTimeEntry e) => e.subject == subject).toList();
    TestSubjectScore? score;
    for (final TestSubjectScore row in scores) {
      if (row.subject == subject) {
        score = row;
        break;
      }
    }
    final int? minutes = sum(mine.map((TestTimeEntry e) => e.minutes).toList());
    final double? marks = score?.marksObtained;
    final SubjectTimeRow row = SubjectTimeRow(
      subject: subject,
      minutes: minutes,
      attempted: sum(mine.map((TestTimeEntry e) => e.attempted).toList()),
      unattempted: sum(mine.map((TestTimeEntry e) => e.unattempted).toList()),
      marks: marks,
      total: score?.totalMarks,
      marksPerMinute: minutes != null && minutes > 0 && marks != null ? marks / minutes : null,
    );
    if (row.minutes != null || row.attempted != null || row.marks != null) rows.add(row);
  }
  return rows;
}

class MockInsight {
  const MockInsight(this.kind, this.text);

  /// 'recorded', 'classified' or 'derived'.
  final String kind;
  final String text;
}

/// `mockInsights`: "what should I fix before my next mock?", each line labelled with its basis.
List<MockInsight> mockInsights(TestRecord test, AppData data) {
  final List<MockInsight> insights = <MockInsight>[];
  final List<TestErrorLog> logs = data.errorLogs.where((TestErrorLog log) => log.testId == test.id).toList();
  final Map<String, List<TestErrorLog>> bySubject = <String, List<TestErrorLog>>{};
  for (final TestErrorLog log in logs) {
    if (log.subject == null || log.subject!.isEmpty) continue;
    bySubject.putIfAbsent(log.subject!, () => <TestErrorLog>[]).add(log);
  }
  final List<String> subjects = <String>[...examSubjectNames(data)];
  for (final String subject in bySubject.keys) {
    if (!subjects.contains(subject)) subjects.add(subject);
  }
  for (final String subject in subjects) {
    final List<TestErrorLog> rows = bySubject[subject] ?? const <TestErrorLog>[];
    final List<TestErrorLog> marked = rows.where((TestErrorLog r) => r.marksLost != null && r.marksLost! > 0).toList();
    final double totalLost = marked.fold<double>(0, (double sum, TestErrorLog r) => sum + r.marksLost!);
    if (totalLost > 0) {
      final Map<String, double> byCategory = <String, double>{};
      for (final TestErrorLog row in marked) {
        byCategory[row.category] = (byCategory[row.category] ?? 0) + row.marksLost!;
      }
      final List<MapEntry<String, double>> sorted = byCategory.entries.toList()
        ..sort((MapEntry<String, double> a, MapEntry<String, double> b) => b.value.compareTo(a.value));
      final MapEntry<String, double> top = sorted.first;
      final int share = (top.value / totalLost * 100).round();
      insights.add(MockInsight(
        'derived',
        share >= 50
            ? '$subject lost ${jsNumberText(totalLost)} marks; $share% of that came from ${top.key.toLowerCase()}.'
            : '$subject lost ${jsNumberText(totalLost)} marks across several causes; the largest was '
                '${top.key.toLowerCase()} (${jsNumberText(top.value)}).',
      ));
    }
    final int avoidable = rows
        .where((TestErrorLog r) =>
            r.category == 'Silly mistake' || r.category == 'Calculation error' || r.category == 'Misread question')
        .fold<int>(0, (int sum, TestErrorLog r) => sum + (r.questions ?? 0));
    if (avoidable >= 2) {
      insights.add(MockInsight(
        'derived',
        '$subject: $avoidable questions were lost to avoidable slips (silly, calculation or misread).',
      ));
    }
  }
  for (final SubjectTimeRow row in subjectTimeRows(test, data)) {
    if (row.minutes != null && row.marks != null && row.total != null && row.total != 0) {
      final double? pct = validPercentage(row.marks, row.total);
      if (pct != null) {
        insights.add(MockInsight(
          'recorded',
          '${row.subject}: ${row.minutes} min spent for ${jsNumberText(row.marks!)} of ${jsNumberText(row.total!)} marks (${pct.round()}%).',
        ));
      }
    }
    if (row.unattempted != null && row.unattempted! > 0) {
      insights.add(MockInsight(
        'recorded',
        '${row.subject}: ${row.unattempted} question${row.unattempted == 1 ? '' : 's'} left unattempted.',
      ));
    }
  }
  final double timeLost = logs
      .where((TestErrorLog log) => log.category == 'Time pressure' && (log.marksLost ?? 0) != 0)
      .fold<double>(0, (double sum, TestErrorLog r) => sum + (r.marksLost ?? 0));
  if (timeLost > 0) insights.add(MockInsight('classified', 'You tagged ${jsNumberText(timeLost)} marks as lost to time pressure.'));
  final int guessed = logs
      .where((TestErrorLog log) => log.category == 'Guess / bad attempt')
      .fold<int>(0, (int sum, TestErrorLog r) => sum + (r.questions ?? 0));
  if (guessed >= 3) {
    insights.add(MockInsight(
      'classified',
      '$guessed questions were tagged as guesses or bad attempts — consider skipping more aggressively.',
    ));
  }
  return insights;
}

/// `mockSummary`: the recorded score and how much lost-mark tagging exists.
({double? score, int taggedQuestions, double? taggedMarks}) mockSummary(TestRecord test, AppData data) {
  final MarksTotal? result = overallTestScore(test, data.testSubjectScores);
  final double? score = result != null && result.total > 0 ? result.marks / result.total * 100 : null;
  final List<TestErrorLog> logs = data.errorLogs.where((TestErrorLog log) => log.testId == test.id).toList();
  final int questions = logs.fold<int>(0, (int sum, TestErrorLog r) => sum + (r.questions ?? 0));
  final List<TestErrorLog> marked = logs.where((TestErrorLog r) => r.marksLost != null).toList();
  return (
    score: score,
    taggedQuestions: questions,
    taggedMarks: marked.isEmpty ? null : marked.fold<double>(0, (double sum, TestErrorLog r) => sum + r.marksLost!),
  );
}
