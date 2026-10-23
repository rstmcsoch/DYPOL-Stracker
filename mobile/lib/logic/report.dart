import 'dart:convert';

import '../data/app_data.dart';
import '../data/models.dart';
import 'aggregation.dart';
import 'progress.dart';

/// A self-contained printable report — the same idea as the website's PDF/DOCX report,
/// built without a PDF engine so it works offline and adds no dependency: the file opens in
/// any browser, where the system print dialog can "Save as PDF".
///
/// Sections: exam setup, syllabus progress, tests (with subject rows), mistakes by type,
/// revision load, study time and weekly goals. Everything is derived from saved rows; nothing
/// is invented, and empty sections say so instead of printing zeros as if they were data.
String buildPrintableReport(
  AppData data, {
  String owner = 'Study notebook',
  String generatedOn = '',
}) {
  final SyllabusProgress progress = syllabusProgress(data);
  final StudyTotals totals = studyTotals(data);
  final String date = generatedOn.isEmpty ? DateTime.now().toIso8601String().split('T').first : generatedOn;
  final StringBuffer out = StringBuffer();

  out.writeln('<!doctype html>');
  out.writeln('<html lang="en"><head><meta charset="utf-8">');
  out.writeln('<meta name="viewport" content="width=device-width, initial-scale=1">');
  out.writeln('<title>Stracker report · ${_esc(date)}</title>');
  out.writeln('''<style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 28px 22px 48px; background: #f7f4ec; color: #29332d;
           font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; line-height: 1.55; }
    main { max-width: 780px; margin: 0 auto; }
    .brand { font-size: 11px; letter-spacing: 2.4px; color: #6b6c62; font-weight: 600; }
    h1 { font-size: 30px; margin: 6px 0 2px; font-weight: 600; }
    .sub { color: #566057; font-size: 13px; margin: 0 0 22px; }
    section { background: #fffdf7; border: 1px solid #e8e2d4; border-radius: 14px;
              padding: 16px 18px; margin-bottom: 14px; page-break-inside: avoid; }
    h2 { font-size: 15px; margin: 0 0 10px; letter-spacing: .2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #efe9dc; }
    th { color: #6b6c62; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; }
    tr:last-child td { border-bottom: 0; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .empty { color: #6b6c62; font-size: 12.5px; margin: 0; }
    .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 4px; }
    .stat { flex: 1 1 140px; border: 1px solid #e8e2d4; border-radius: 10px; padding: 10px 12px; }
    .stat b { display: block; font-size: 20px; font-weight: 600; }
    .stat span { font-size: 11.5px; color: #6b6c62; }
    footer { text-align: center; font-size: 11px; color: #6b6c62; margin-top: 18px; }
    @media print { body { background: #fff; padding: 0; } section { break-inside: avoid; } }
  </style>''');
  out.writeln('</head><body><main>');
  out.writeln('<p class="brand">STRAKER · DYPOL LABS</p>');
  out.writeln('<h1>Study report</h1>');
  out.writeln('<p class="sub">${_esc(owner)} · generated ${_esc(date)}</p>');

  // Setup
  out.writeln('<section><h2>Exam setup</h2><table>');
  out.writeln('<tr><th>Main exam</th><td>${_esc(data.settings.mainExamDate ?? 'Not set')}</td></tr>');
  out.writeln('<tr><th>Advanced exam</th><td>${_esc(data.settings.advancedExamDate ?? 'Not set')}</td></tr>');
  out.writeln('<tr><th>Target score</th><td>${data.settings.targetScore > 0 ? data.settings.targetScore.toStringAsFixed(0) : 'Not set'}</td></tr>');
  out.writeln('</table></section>');

  // Syllabus
  out.writeln('<section><h2>Syllabus</h2><div class="stats">');
  out.writeln('<div class="stat"><b>${_pct(progress.raw)}</b><span>raw completion</span></div>');
  out.writeln('<div class="stat"><b>${_pct(progress.weighted)}</b><span>importance-weighted</span></div>');
  out.writeln('<div class="stat"><b>${progress.completedChapters}/${progress.totalChapters}</b><span>chapters done or revised</span></div>');
  out.writeln('</div>');
  final Map<String, List<Chapter>> bySubject = <String, List<Chapter>>{};
  for (final Chapter chapter in data.chapters) {
    bySubject.putIfAbsent(chapter.subject, () => <Chapter>[]).add(chapter);
  }
  if (bySubject.isEmpty) {
    out.writeln('<p class="empty">No chapters recorded yet.</p>');
  } else {
    out.writeln('<table><tr><th>Subject</th><th class="num">Chapters</th><th class="num">Weight</th></tr>');
    for (final MapEntry<String, List<Chapter>> entry in bySubject.entries) {
      final double weight = entry.value.fold<double>(
          0, (double sum, Chapter c) => sum + (double.tryParse(c.weightage ?? '') ?? 0));
      out.writeln('<tr><td>${_esc(entry.key)}</td><td class="num">${entry.value.length}</td>'
          '<td class="num">${weight.toStringAsFixed(1)}</td></tr>');
    }
    out.writeln('</table>');
  }
  out.writeln('</section>');

  // Tests
  out.writeln('<section><h2>Tests</h2>');
  if (data.tests.isEmpty) {
    out.writeln('<p class="empty">No tests recorded yet.</p>');
  } else {
    out.writeln('<table><tr><th>Date</th><th>Title</th><th>Type</th>'
        '<th class="num">Score</th></tr>');
    final List<TestRecord> sorted = <TestRecord>[...data.tests]
      ..sort((TestRecord a, TestRecord b) => b.testDate.compareTo(a.testDate));
    for (final TestRecord test in sorted) {
      out.writeln('<tr><td>${_esc(test.testDate)}</td><td>${_esc(test.title)}</td>'
          '<td>${_esc(test.testType)}</td>'
          '<td class="num">${_mark(test.marksObtained, test.totalMarks)}</td></tr>');
    }
    out.writeln('</table>');
    final List<TestSubjectScore> scores = data.testSubjectScores;
    if (scores.isNotEmpty) {
      out.writeln('<h2 style="margin-top:14px">Subject scores</h2>');
      out.writeln('<table><tr><th>Test</th><th>Subject</th><th class="num">Marks</th></tr>');
      for (final TestSubjectScore score in scores.take(40)) {
        String title = '—';
        for (final TestRecord test in data.tests) {
          if (test.id == score.testId) {
            title = test.title;
            break;
          }
        }
        out.writeln('<tr><td>${_esc(title)}</td><td>${_esc(score.subject)}</td>'
            '<td class="num">${_mark(score.marksObtained, score.totalMarks)}</td></tr>');
      }
      out.writeln('</table>');
    }
  }
  out.writeln('</section>');

  // Mistakes
  out.writeln('<section><h2>Mistakes</h2>');
  if (data.mistakes.isEmpty) {
    out.writeln('<p class="empty">No mistakes logged yet.</p>');
  } else {
    final Map<String, int> byType = <String, int>{};
    for (final Mistake mistake in data.mistakes) {
      byType[mistake.mistakeType.isEmpty ? 'unspecified' : mistake.mistakeType] =
          (byType[mistake.mistakeType.isEmpty ? 'unspecified' : mistake.mistakeType] ?? 0) + 1;
    }
    out.writeln('<table><tr><th>Reason</th><th class="num">Count</th></tr>');
    for (final MapEntry<String, int> entry in byType.entries) {
      out.writeln('<tr><td>${_esc(entry.key)}</td><td class="num">${entry.value}</td></tr>');
    }
    out.writeln('</table>');
    out.writeln('<p class="empty">${data.pendingRetries.length} waiting in the retry queue.</p>');
  }
  out.writeln('</section>');

  // Study time and goals
  out.writeln('<section><h2>Study time</h2><div class="stats">');
  out.writeln('<div class="stat"><b>${totals.totalMinutes ~/ 60}h ${totals.totalMinutes % 60}m</b>'
      '<span>recorded study time</span></div>');
  out.writeln('<div class="stat"><b>${totals.streak}</b><span>day streak</span></div>');
  out.writeln('</div>');
  if (data.goals.isNotEmpty) {
    out.writeln('<table><tr><th>Goal</th><th class="num">Progress</th><th class="num">Target</th></tr>');
    for (final WeeklyGoal goal in data.goals) {
      out.writeln('<tr><td>${_esc(goal.title.isEmpty ? goal.goalType : goal.title)}</td>'
          '<td class="num">${goal.progressValue.toStringAsFixed(1)}</td>'
          '<td class="num">${goal.target.toStringAsFixed(1)}${goal.unit.isEmpty ? '' : ' ${_esc(goal.unit)}'}</td></tr>');
    }
    out.writeln('</table>');
  }
  out.writeln('</section>');

  out.writeln('<footer>Stracker · DYPOL LABS · printed from your own account</footer>');
  out.writeln('</main></body></html>');
  return out.toString();
}

/// UTF-8 bytes, so the file opens correctly on a phone.
List<int> printableReportBytes(
  AppData data, {
  String owner = 'Study notebook',
  String generatedOn = '',
}) =>
    utf8.encode(buildPrintableReport(data, owner: owner, generatedOn: generatedOn));

String _esc(String value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

String _pct(double? fraction) => fraction == null
    ? '—'
    : '${(fraction * 100).clamp(0, 100).toStringAsFixed(1)}%';

String _mark(double? obtained, double? total) {
  if (obtained == null || total == null || total == 0) return '—';
  return '${obtained.toStringAsFixed(1)} / ${total.toStringAsFixed(0)}';
}
