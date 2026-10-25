/// Minimal database rows for seeding the fake backend (only the columns the app reads).
Map<String, dynamic> chapterRow(String id, String name, {String subject = 'Physics', int position = 0}) =>
    <String, dynamic>{
      'id': id,
      'user_id': 'u1',
      'subject': subject,
      'name': name,
      'position': position,
      'status': 'Not Started',
      'priority': 'Medium',
      'importance': 'medium',
      'notes': '',
      'formula_notes': '',
      'created_at': '2026-10-01T10:00:00Z',
      'updated_at': '2026-10-01T10:00:00Z',
    };

Map<String, dynamic> mistakeRow(String id, String chapterId, String question,
        {bool retryLater = false, String retryStatus = 'pending'}) =>
    <String, dynamic>{
      'id': id,
      'user_id': 'u1',
      'chapter_id': chapterId,
      'test_id': null,
      'mistake_type': 'Concept',
      'question_note': question,
      'solution_note': 'Remember the sign convention.',
      'image_path': null,
      'retry_later': retryLater,
      'retry_status': retryStatus,
      'created_at': '2026-10-10T10:00:00Z',
      'updated_at': '2026-10-10T10:00:00Z',
    };

Map<String, dynamic> testRow(String id, String title, {String date = '2026-10-12'}) => <String, dynamic>{
      'id': id,
      'user_id': 'u1',
      'title': title,
      'test_date': date,
      'test_type': 'Chapter Test',
      'subject': 'Physics',
      'marks_obtained': 40,
      'total_marks': 60,
      'notes': '',
      'created_at': '2026-10-12T10:00:00Z',
      'updated_at': '2026-10-12T10:00:00Z',
    };

Map<String, dynamic> taskRow(String id, String title, String date) => <String, dynamic>{
      'id': id,
      'user_id': 'u1',
      'title': title,
      'estimated_minutes': 30,
      'priority': 'Medium',
      'is_completed': false,
      'task_date': date,
      'position': 0,
      'created_at': '2026-10-12T10:00:00Z',
      'updated_at': '2026-10-12T10:00:00Z',
    };

Map<String, dynamic> backlogRow(String id, String title, {String status = 'active'}) => <String, dynamic>{
      'id': id,
      'user_id': 'u1',
      'title': title,
      'type': 'Topic',
      'priority': 'Medium',
      'status': status,
      'notes': '',
      'completed_at': status == 'done' ? '2026-10-14T10:00:00Z' : null,
      'created_at': '2026-10-12T10:00:00Z',
      'updated_at': '2026-10-12T10:00:00Z',
    };

Map<String, dynamic> cardRow(String id, String chapterId, String front) => <String, dynamic>{
      'id': id,
      'user_id': 'u1',
      'chapter_id': chapterId,
      'kind': 'formula',
      'front': front,
      'back': 'V = IR',
      'hint': '',
      'reviews': 0,
      'created_at': '2026-10-12T10:00:00Z',
      'updated_at': '2026-10-12T10:00:00Z',
    };
