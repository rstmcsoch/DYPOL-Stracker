import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/data/app_data.dart';
import 'package:stracker/data/models.dart';
import 'package:stracker/data/syllabus_seed.dart';
import 'package:stracker/logic/progress.dart';

void main() {
  test('the seeded syllabus matches the website chapter list', () {
    expect(seededSyllabus.keys, <String>['Physics', 'Chemistry', 'Maths']);
    expect(seededSyllabus['Physics']!.length, 20);
    expect(seededSyllabus['Chemistry']!.length, 22);
    expect(seededSyllabus['Maths']!.length, 22);
    final List<String> all = seededSyllabus.values.expand((List<String> names) => names).toList();
    expect(all.toSet().length, all.length, reason: 'chapter names are unique across subjects');
    expect(all, containsAll(<String>['Work Energy Power', 'p-Block', 'GOC', '3D Geometry']));
  });

  test('the four default exam tracks are seeded per account', () {
    final List<UserExamTrack> tracks = seedExamTracks('user-1');
    expect(tracks.map((UserExamTrack t) => t.track), <String>['main1', 'main2', 'advanced', 'boards']);
    expect(tracks.first.id, 'user-1-main1');
    expect(tracks.first.label, 'JEE Main — Session 1');
  });

  test('importance weights come from the account settings', () {
    final AppSettings settings = AppSettings.defaults('u1');
    expect(importanceWeight(settings, 'High'), settings.weightHigh);
    expect(importanceWeight(settings, 'Medium'), settings.weightMedium);
    expect(importanceWeight(settings, 'Low'), settings.weightLow);
  });

  test('progress is empty rather than 0% when nothing is tracked', () {
    final AppData data = AppData(userId: 'u1', settings: AppSettings.defaults('u1'));
    final SyllabusProgress progress = syllabusProgress(data);
    expect(progress.isEmpty, isTrue);
    expect(progress.raw, isNull);
  });

  test('completing a chapter raises completion', () {
    final AppData data = AppData(
      userId: 'u1',
      settings: AppSettings.defaults('u1'),
      chapters: const <Chapter>[
        Chapter(id: 'c1', userId: 'u1', subject: 'Physics', name: 'Kinematics', status: 'Done'),
        Chapter(id: 'c2', userId: 'u1', subject: 'Physics', name: 'Optics', status: 'Studying'),
      ],
    );
    final SyllabusProgress progress = syllabusProgress(data);
    expect(progress.totalChapters, 2);
    expect(progress.completedChapters, 1);
    expect(progress.raw, closeTo(50, 0.001));
  });
}
