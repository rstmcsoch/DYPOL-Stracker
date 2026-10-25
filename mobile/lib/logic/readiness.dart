import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';
import 'analytics.dart';
import 'exam.dart';
import 'progress.dart';

/// One part of a track's readiness; null when there is no data for it yet.
class ReadinessPart {
  const ReadinessPart({required this.label, required this.value, required this.note});

  final String label;
  final double? value;
  final String note;
}

class TrackReadiness {
  const TrackReadiness({
    required this.track,
    required this.label,
    required this.percent,
    required this.components,
    required this.daysLeft,
    required this.target,
  });

  final String track;
  final String label;
  final double? percent;
  final List<ReadinessPart> components;
  final int? daysLeft;
  final double? target;
}

/// src/lib/jee/exam.ts `trackReadiness`: weighted syllabus completion, PYQ completion for
/// the track's exam (not Boards) and the average of the three most recent tests. Parts with
/// no data are left out of the average and say so.
TrackReadiness trackReadiness(AppData data, String track, String today) {
  final SyllabusProgress progress = syllabusProgress(data);
  final bool jee = isJeeSettings(data.settings);
  // Non-JEE exams keep their PYQ years in the single (Main) column of the PYQ tracker.
  final String? pyqExam = jee ? trackPyqExam[track] : 'Main';
  final PyqCompletion? pyq = pyqExam == null ? null : pyqCompletion(data.pyqRecords, null, pyqExam, data.settings);
  final List<TestRecord> recent = <TestRecord>[...data.tests]
    ..sort((TestRecord a, TestRecord b) => b.testDate.compareTo(a.testDate));
  final List<TestRecord> lastThree = recent.take(3).toList();
  final double? testAverage = meanTestPercentage(lastThree, data.testSubjectScores).average;
  final List<ReadinessPart> components = <ReadinessPart>[
    ReadinessPart(
      label: 'Weighted syllabus',
      value: progress.weighted,
      note: progress.weighted == null ? 'No chapters yet' : 'Shared syllabus',
    ),
    ReadinessPart(
      label: pyqExam != null && jee ? (pyqExam == 'Main' ? 'JEE Main PYQs' : 'JEE Advanced PYQs') : 'PYQs',
      value: pyq?.percent,
      note: pyq != null ? '${pyq.done} of ${pyq.total} years' : (jee ? 'Not used for Boards' : 'JEE PYQ tracker only'),
    ),
    ReadinessPart(
      label: 'Recent tests',
      value: testAverage,
      note: lastThree.isEmpty ? 'No tests yet' : 'Last ${lastThree.length} test${lastThree.length == 1 ? '' : 's'}',
    ),
  ];
  final List<double> usable = <double>[
    for (final ReadinessPart part in components)
      if (part.value != null) part.value!,
  ];
  final UserExamTrack config = trackConfig(data, track);
  final String? date = trackDate(data, track);
  return TrackReadiness(
    track: track,
    label: trackLabels(data)[track] ?? track,
    percent: usable.isEmpty ? null : usable.reduce((double a, double b) => a + b) / usable.length,
    components: components,
    daysLeft: date == null || date.isEmpty ? null : daysBetween(today, date),
    target: config.targetScore,
  );
}

List<TrackReadiness> allTrackReadiness(AppData data, String today) => <TrackReadiness>[
      for (final String track in availableTracks(data.settings)) trackReadiness(data, track, today),
    ];
