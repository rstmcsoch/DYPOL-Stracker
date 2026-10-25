import '../core/date.dart';
import '../data/app_data.dart';
import '../data/models.dart';
import 'progress.dart';

/// Spaced revision: completing revision N schedules N+1 using the account's gap list
/// (Settings → Study rhythm, default 1 / 7 / 30 days).
Revision? nextRevision({
  required AppData data,
  required Revision completed,
  String? today,
}) {
  // Same rule as the website's completeRevision: the rung's place in the gap list is
  // (number - 1) mod length, the next rung uses the following gap (at least one day), and
  // nothing is added when that rung already exists for the chapter.
  final List<int> gaps = data.settings.revisionGaps;
  if (gaps.isEmpty) return null;
  final int position = (completed.revisionNumber - 1) % gaps.length;
  if (position >= gaps.length - 1) return null;
  final int nextNumber = completed.revisionNumber + 1;
  final bool exists = data.revisions.any(
    (Revision item) => item.chapterId == completed.chapterId && item.revisionNumber == nextNumber,
  );
  if (exists) return null;
  final int gap = gaps[position + 1] < 1 ? 1 : gaps[position + 1];
  return Revision(
    id: newId(),
    userId: data.userId,
    chapterId: completed.chapterId,
    revisionNumber: nextNumber,
    dueOn: addDays(today ?? todayIso(), gap),
    createdAt: isoNow(),
    updatedAt: isoNow(),
  );
}

/// The first revision of a new ladder for a chapter. Numbers continue after the chapter's
/// highest existing rung: (chapter_id, revision_number) is unique in the database, so a
/// chapter that finished an earlier ladder must not reuse R1.
Revision startRevisionChain(AppData data, String chapterId) {
  final List<int> gaps = data.settings.revisionGaps;
  final int number = data.revisions
          .where((Revision revision) => revision.chapterId == chapterId)
          .fold<int>(0, (int max, Revision revision) => revision.revisionNumber > max ? revision.revisionNumber : max) +
      1;
  final int gap = gaps.isEmpty ? 1 : gaps[(number - 1) % gaps.length];
  return Revision(
    id: newId(),
    userId: data.userId,
    chapterId: chapterId,
    revisionNumber: number,
    dueOn: addDays(todayIso(), gap < 1 ? 1 : gap),
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
  final List<Revision> open = data.openRevisions()..sort((Revision a, Revision b) => a.dueOn.compareTo(b.dueOn));
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
          revision.completedAt != null && daysBetween(todayIso(), revision.completedAt!.substring(0, 10)) >= -14)
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
  return data.chapters.where((Chapter chapter) => chapter.isComplete && !tracked.contains(chapter.id)).toList();
}

/// How many stages are already done for a chapter (used on revision cards).
int completedStageCount(AppData data, Chapter chapter) =>
    chapterStages(data, chapter).where((StageState stage) => stage.done).length;
