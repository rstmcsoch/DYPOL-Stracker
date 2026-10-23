import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';
import 'progress.dart';

/// Spaced revision: completing revision N schedules N+1 using the account's gap list
/// (Settings → Study rhythm, default 1 / 7 / 30 days).
Revision? nextRevision({
  required AppData data,
  required Revision completed,
}) {
  final List<int> gaps = data.settings.revisionGaps;
  final int index = completed.revisionNumber - 1;
  if (gaps.isEmpty || index + 1 >= gaps.length) return null;
  final int gap = gaps[index + 1];
  return Revision(
    id: newId(),
    userId: data.userId,
    chapterId: completed.chapterId,
    revisionNumber: completed.revisionNumber + 1,
    dueOn: addDays(todayIso(), gap),
    createdAt: isoNow(),
    updatedAt: isoNow(),
  );
}

/// The first revision for a chapter that is being marked Revised/Done.
Revision startRevisionChain(AppData data, String chapterId) {
  final List<int> gaps = data.settings.revisionGaps;
  return Revision(
    id: newId(),
    userId: data.userId,
    chapterId: chapterId,
    revisionNumber: 1,
    dueOn: addDays(todayIso(), gaps.isEmpty ? 1 : gaps.first),
    createdAt: isoNow(),
    updatedAt: isoNow(),
  );
}

class RevisionBuckets {
  const RevisionBuckets({
    required this.overdue,
    required this.today,
    required this.upcoming,
    required this.completedRecently,
  });

  final List<Revision> overdue;
  final List<Revision> today;
  final List<Revision> upcoming;
  final List<Revision> completedRecently;

  bool get isEmpty => overdue.isEmpty && today.isEmpty && upcoming.isEmpty;
  int get openCount => overdue.length + today.length + upcoming.length;
}

RevisionBuckets revisionBuckets(AppData data, {String? today}) {
  final String day = today ?? todayIso();
  final List<Revision> open = data.openRevisions()
    ..sort((Revision a, Revision b) => a.dueOn.compareTo(b.dueOn));
  final List<Revision> overdue = <Revision>[];
  final List<Revision> dueToday = <Revision>[];
  final List<Revision> upcoming = <Revision>[];
  for (final Revision revision in open) {
    if (daysBetween(day, revision.dueOn) < 0) {
      overdue.add(revision);
    } else if (revision.dueOn == day) {
      dueToday.add(revision);
    } else {
      upcoming.add(revision);
    }
  }
  final List<Revision> recent = data.revisions
      .where((Revision revision) =>
          revision.completedAt != null &&
          daysBetween(todayIso(), revision.completedAt!.substring(0, 10)) >= -14)
      .toList()
    ..sort((Revision a, Revision b) => (b.completedAt ?? '').compareTo(a.completedAt ?? ''));
  return RevisionBuckets(
    overdue: overdue,
    today: dueToday,
    upcoming: upcoming,
    completedRecently: recent,
  );
}

/// Chapters that have never been put on the revision ladder.
List<Chapter> chaptersWithoutRevision(AppData data) {
  final Set<String> tracked = data.revisions.map((Revision revision) => revision.chapterId).toSet();
  return data.chapters
      .where((Chapter chapter) => chapter.isComplete && !tracked.contains(chapter.id))
      .toList();
}

/// How many stages are already done for a chapter (used on revision cards).
int completedStageCount(AppData data, Chapter chapter) =>
    chapterStages(data, chapter).where((StageState stage) => stage.done).length;
