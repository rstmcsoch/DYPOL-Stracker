import '../data/app_data.dart';
import '../data/models.dart';
import 'analytics.dart' show scoreSubjectBase;

/// Marking defaults for the Log-a-test form, ported from src/lib/exams/marking.ts. The
/// scheme comes from the published `exam_catalog.marking_scheme`; JEE keeps a built-in
/// fallback so the default notebook works before the catalog loads. Defaults only
/// pre-fill a new form and every value stays editable.

class MarkingPaper {
  const MarkingPaper(this.id, this.label, this.total, this.perSubject);
  final String id;
  final String label;
  final double total;
  final Map<String, double> perSubject;
}

class MarkingPattern {
  const MarkingPattern(
      {this.total,
      this.perSubject = const <String, double>{},
      this.defaultPerSubject,
      this.papers = const <MarkingPaper>[]});
  final double? total;
  final Map<String, double> perSubject;
  final double? defaultPerSubject;
  final List<MarkingPaper> papers;
}

class MarkingScheme {
  const MarkingScheme(
      {required this.full, required this.other, required this.source, this.combine = 'sum_subjects', this.notes});
  final MarkingPattern full;
  final MarkingPattern other;
  final String source;
  final String combine;
  final String? notes;
}

const Map<String, double> _jeePaper = <String, double>{'Physics': 60, 'Chemistry': 60, 'Maths': 60};

const MarkingScheme builtInJeeScheme = MarkingScheme(
  full: MarkingPattern(
    total: 300,
    perSubject: <String, double>{'Physics': 100, 'Chemistry': 100, 'Maths': 100},
    papers: <MarkingPaper>[
      MarkingPaper('advanced-paper-1', 'Paper 1', 180, _jeePaper),
      MarkingPaper('advanced-paper-2', 'Paper 2', 180, _jeePaper),
    ],
  ),
  other: MarkingPattern(total: 180, perSubject: _jeePaper),
  source: 'NTA JEE (Main) and IIT JEE (Advanced) 2026',
  combine: 'sum_papers',
  notes:
      'Full Mock asks Main, Advanced Paper 1 only, or Advanced Paper 1 + Paper 2. Both Advanced papers combine to 360.',
);

double? _positive(Object? value) =>
    value is num && value.isFinite && value > 0 && value <= 100000 ? value.toDouble() : null;

String? _label(Object? value, [int max = 60]) {
  if (value is! String) return null;
  final String clean = value.trim();
  return clean.isNotEmpty && clean.length <= max ? clean : null;
}

Map<String, double>? _subjects(Object? raw) {
  if (raw is! Map) return null;
  final Map<String, double> out = <String, double>{};
  for (final MapEntry<Object?, Object?> entry in raw.entries.take(40)) {
    final String? name = _label(entry.key);
    final double? amount = _positive(entry.value);
    if (name == null || amount == null) return null;
    out[name] = amount;
  }
  return out;
}

MarkingPattern? _pattern(Object? raw) {
  if (raw is! Map) return null;
  final Object? rawTotal = raw['total'];
  final double? total = rawTotal == null ? null : _positive(rawTotal);
  if (rawTotal != null && total == null) return null;
  final Map<String, double>? perSubject = _subjects(raw['perSubject']);
  if (perSubject == null) return null;
  final Object? rawDefault = raw['defaultPerSubject'];
  final double? defaultPerSubject = rawDefault == null ? null : _positive(rawDefault);
  if (rawDefault != null && defaultPerSubject == null) return null;
  final List<MarkingPaper> papers = <MarkingPaper>[];
  final Object? rawPapers = raw['papers'];
  if (rawPapers != null) {
    if (rawPapers is! List || rawPapers.length > 6) return null;
    for (final Object? paper in rawPapers) {
      if (paper is! Map) return null;
      final String? id = _label(paper['id'], 40);
      final String? label = _label(paper['label']);
      final double? paperTotal = _positive(paper['total']);
      final Map<String, double>? subjects = _subjects(paper['perSubject']);
      if (id == null || label == null || paperTotal == null || subjects == null) return null;
      papers.add(MarkingPaper(id, label, paperTotal, subjects));
    }
  }
  return MarkingPattern(total: total, perSubject: perSubject, defaultPerSubject: defaultPerSubject, papers: papers);
}

/// Structural validation for a stored scheme; null for anything unusable.
MarkingScheme? normalizeMarkingScheme(Map<String, dynamic>? raw) {
  if (raw == null) return null;
  final MarkingPattern? full = _pattern(raw['full']);
  final MarkingPattern? other = _pattern(raw['other']);
  final String? source = _label(raw['source'], 200);
  final Object? combine = raw['combine'];
  final String? rule = combine == null || combine == 'sum_subjects'
      ? 'sum_subjects'
      : (combine == 'sum_papers' || combine == 'per_subject')
          ? combine as String
          : null;
  if (full == null || other == null || source == null || rule == null) return null;
  final String? notes = raw['notes'] == null ? null : _label(raw['notes'], 500);
  if (raw['notes'] != null && notes == null) return null;
  return MarkingScheme(full: full, other: other, source: source, combine: rule, notes: notes);
}

/// The scheme for the student's exam: catalog first, JEE built-in as the fallback.
MarkingScheme? markingSchemeFor(AppData data) {
  final String? examId = data.settings.examId;
  for (final ExamCatalogEntry entry in data.examCatalog) {
    if (entry.id == (examId ?? 'jee')) {
      final MarkingScheme? stored = normalizeMarkingScheme(entry.markingScheme);
      if (stored != null) return stored;
    }
  }
  return isJeeExam(examId) ? builtInJeeScheme : null;
}

double? defaultForSubject(MarkingPattern pattern, String subject) {
  final String base = scoreSubjectBase(subject);
  if (pattern.perSubject.containsKey(subject)) return pattern.perSubject[subject];
  if (pattern.perSubject.containsKey(base)) return pattern.perSubject[base];
  if ((base == 'Botany' || base == 'Zoology') && pattern.perSubject.containsKey('Biology')) {
    return pattern.perSubject['Biology']! / 2;
  }
  if (base == 'Biology' && pattern.perSubject.containsKey('Botany') && pattern.perSubject.containsKey('Zoology')) {
    return pattern.perSubject['Botany']! + pattern.perSubject['Zoology']!;
  }
  return pattern.defaultPerSubject;
}

String _num(double? value) =>
    value == null ? '' : (value == value.truncateToDouble() ? value.toInt().toString() : value.toString());

/// JEE Full Mock paper patterns, as the website's select.
const Map<String, String> jeeFullPatterns = <String, String>{
  'main': 'JEE Main — 300 total',
  'advanced-paper-1': 'JEE Advanced — Paper 1 only (180)',
  'advanced-both': 'JEE Advanced — Both papers (360 combined)',
};

/// Ordered score rows (label -> default total) for a Full Mock.
Map<String, String> fullMockDefaults(MarkingScheme? scheme, List<String> subjects, [String jeePattern = 'main']) {
  final Map<String, String> out = <String, String>{};
  if (scheme == null) return <String, String>{for (final String s in subjects) s: ''};
  if (jeePattern != 'main' && scheme.full.papers.isNotEmpty) {
    final List<MarkingPaper> papers =
        jeePattern == 'advanced-paper-1' ? scheme.full.papers.take(1).toList() : scheme.full.papers;
    for (final MarkingPaper paper in papers) {
      for (final String subject in subjects) {
        final double? total = paper.perSubject[subject] ?? paper.perSubject[scoreSubjectBase(subject)];
        if (total != null) out['$subject — ${paper.label}'] = _num(total);
      }
    }
    return out;
  }
  for (final String subject in subjects) {
    out[subject] = _num(defaultForSubject(scheme.full, subject));
  }
  return out;
}

String defaultTotalFor(MarkingScheme? scheme, String testType, String? subject) {
  if (scheme == null) return '';
  final MarkingPattern selected = testType == 'Full Mock' ? scheme.full : scheme.other;
  if (subject != null) return _num(defaultForSubject(selected, subject));
  return _num(selected.total);
}

/// The website infers the pattern of a saved JEE Full Mock from its score rows.
String inferJeePattern(String? testType, List<TestSubjectScore> scores) {
  if (scores.any((TestSubjectScore s) => RegExp(r'\s—\sPaper\s[12]$', caseSensitive: false).hasMatch(s.subject))) {
    return 'advanced-both';
  }
  if (testType == 'Full Mock' && scores.isNotEmpty && scores.every((TestSubjectScore s) => s.totalMarks == 60)) {
    return 'advanced-paper-1';
  }
  return 'main';
}
