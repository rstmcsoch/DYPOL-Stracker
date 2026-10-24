/// Validation rules ported from the website's zod schemas
/// (src/lib/auth-rules.ts, task-validation.ts, goal-validation.ts, settings-validation.ts,
/// test-validation.ts, record-validation.ts). The server remains the authority; these keep
/// the same messages so a form behaves identically in the app.
class Validators {
  const Validators._();

  static const int minPasswordLength = 8;
  static const int postgresIntegerMax = 2147483647;
  static const double maxTotalMarks = 9999999;
  static const double maxMarksObtained = 9999999.5;
  static const double maxNegativeMarks = 999999.75;

  static String? required(String? value, {String message = 'This field is required.'}) {
    return (value ?? '').trim().isEmpty ? message : null;
  }

  static String? email(String? value) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return 'Enter your email address.';
    final RegExp pattern = RegExp(r'^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$');
    return pattern.hasMatch(text) ? null : 'That email address does not look right.';
  }

  static String? password(String? value) {
    final String text = value ?? '';
    if (text.isEmpty) return 'Enter your password.';
    return text.length < minPasswordLength ? 'Use at least $minPasswordLength characters.' : null;
  }

  static String? confirmPassword(String? value, String original) {
    if ((value ?? '').isEmpty) return 'Repeat your new password.';
    return value == original ? null : 'Both passwords must match.';
  }

  static String? displayName(String? value) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return 'Add a name for your notebook.';
    return text.length > 100 ? 'Keep the name under 100 characters.' : null;
  }

  static String? name(String? value, {int max = 160, String label = 'Title'}) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return '$label is required.';
    return text.length > max ? '$label can be at most $max characters.' : null;
  }

  static String? date(String? value) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return 'Choose a valid date.';
    return RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text) ? null : 'Choose a valid date.';
  }

  /// Practice counts must be consistent: correct + incorrect ≤ attempted.
  static String? practiceCounts({required int attempted, required int correct, required int incorrect}) {
    if (attempted < 0 || attempted > 100000) return 'Attempted must be between 0 and 100,000.';
    if (correct < 0 || incorrect < 0) return 'Counts cannot be negative.';
    if (correct + incorrect > attempted) return 'Correct plus incorrect cannot exceed attempted.';
    return null;
  }

  /// Incorrect is always derived: attempted − correct. Null until both are valid.
  static int? derivedIncorrect(String attempted, String correct) {
    final int? a = int.tryParse(attempted.trim());
    final int? c = int.tryParse(correct.trim());
    if (a == null || c == null || a < 0 || c < 0 || c > a) return null;
    return a - c;
  }

  static String? practiceCorrect({required int attempted, required int correct}) {
    if (attempted < 0 || attempted > 100000) return 'Attempted must be between 0 and 100,000.';
    if (correct < 0) return 'Counts cannot be negative.';
    if (correct > attempted) return 'Correct ($correct) can’t be more than attempted ($attempted).';
    return null;
  }

  static String? minutes(String? value, {int max = 1440, String label = 'Minutes'}) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return null;
    final int? parsed = int.tryParse(text);
    if (parsed == null) return '$label must be a whole number.';
    if (parsed < 0) return '$label cannot be negative.';
    if (parsed > max) return '$label cannot exceed $max.';
    return null;
  }

  static String? intInRange(String? value, {int min = 0, int max = postgresIntegerMax, String label = 'Value'}) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return null;
    final int? parsed = int.tryParse(text);
    if (parsed == null) return '$label must be a whole number.';
    if (parsed < min || parsed > max) return '$label must be between $min and $max.';
    return null;
  }

  /// Marks can be awarded in half points; totals are whole marks.
  static String? marksObtained(String? value) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return null;
    final double? parsed = double.tryParse(text);
    if (parsed == null) return 'Enter marks as a number.';
    if (parsed < 0) return 'Marks cannot be negative.';
    if (parsed > maxMarksObtained) return 'Marks are too large.';
    if ((parsed * 2) != (parsed * 2).roundToDouble()) return 'Marks must be in half-point steps.';
    return null;
  }

  static String? totalMarks(String? value) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return null;
    final int? parsed = int.tryParse(text);
    if (parsed == null) return 'Enter a whole-number total.';
    if (parsed < 1) return 'Total marks must be at least 1.';
    if (parsed > maxTotalMarks) return 'Total marks are too large.';
    return null;
  }

  static String? negativeMarks(String? value) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return null;
    final double? parsed = double.tryParse(text);
    if (parsed == null) return 'Enter negative marks as a number.';
    if (parsed < 0) return 'Negative marks cannot be negative here.';
    if (parsed > maxNegativeMarks) return 'Negative marks are too large.';
    if ((parsed * 4) != (parsed * 4).roundToDouble()) return 'Use quarter-mark steps.';
    return null;
  }

  /// Score sanity shared by tests, subject scores and chapter links.
  static String? scorePair(double? obtained, double? total) {
    if (obtained != null && total == null) {
      return 'Add a positive whole-number total to record a score.';
    }
    if (obtained != null && total != null && obtained > total) {
      return 'Marks obtained cannot exceed total marks.';
    }
    return null;
  }

  static String? thresholds(double weak, double strong, double dropping) {
    if (weak >= strong) return 'Weak threshold must be lower than the strong threshold.';
    if (weak < 0 || strong > 100 || dropping < 0 || dropping > 100) {
      return 'Thresholds must stay between 0 and 100.';
    }
    return null;
  }

  static String? weights(double high, double medium, double low) {
    for (final double value in <double>[high, medium, low]) {
      if (value < 0.1 || value > 10) return 'Importance weights must be between 0.1 and 10.';
    }
    return null;
  }

  static String? years(int from, int to) {
    if (from < 1990 || to > 2100) return 'Choose years between 1990 and 2100.';
    if (from > to) return 'The first PYQ year must not be after the last year.';
    return null;
  }

  static String? revisionGaps(String raw) {
    final List<String> parts = raw.split(RegExp(r'[,\s]+')).where((part) => part.isNotEmpty).toList();
    if (parts.isEmpty) return 'Keep at least one revision gap.';
    if (parts.length > 12) return 'Use at most 12 revision gaps.';
    for (final String part in parts) {
      final int? value = int.tryParse(part);
      if (value == null || value <= 0) return 'Gaps must be positive whole days.';
    }
    return null;
  }

  static String? reminderTime(String raw) {
    return RegExp(r'^([01]\d|2[0-3]):[0-5]\d$').hasMatch(raw.trim())
        ? null
        : 'Use a 24-hour time such as 08:00.';
  }

  static String? dailyGoal(String raw) {
    final int? value = int.tryParse(raw.trim());
    if (value == null) return 'Enter whole minutes.';
    if (value < 0) return 'The daily goal cannot be negative.';
    return null;
  }
}
