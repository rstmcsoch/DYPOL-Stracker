-- Keep numeric rules at the database boundary aligned with the client forms and validators.
-- NOT VALID allows older rows to remain readable, but any existing row that violates a
-- new check must be audited before deployment because PostgreSQL still enforces the check
-- on inserts and updates. Do not round or rewrite historic user scores automatically.

ALTER TABLE public.tests
  ADD CONSTRAINT tests_total_marks_integer
    CHECK (total_marks IS NULL OR (total_marks = trunc(total_marks) AND total_marks <= 9999999)) NOT VALID,
  ADD CONSTRAINT tests_marks_half_point
    CHECK (marks_obtained IS NULL OR (marks_obtained <= 9999999.5 AND marks_obtained * 2 = trunc(marks_obtained * 2))) NOT VALID,
  ADD CONSTRAINT tests_negative_marks_quarter_point
    CHECK (negative_marks IS NULL OR (negative_marks <= 999999.75 AND negative_marks * 4 = trunc(negative_marks * 4))) NOT VALID,
  ADD CONSTRAINT tests_score_requires_total
    CHECK (marks_obtained IS NULL OR total_marks IS NOT NULL) NOT VALID;

ALTER TABLE public.test_subject_scores
  ADD CONSTRAINT test_subject_scores_total_marks_integer
    CHECK (total_marks IS NULL OR (total_marks = trunc(total_marks) AND total_marks <= 9999999)) NOT VALID,
  ADD CONSTRAINT test_subject_scores_marks_half_point
    CHECK (marks_obtained IS NULL OR (marks_obtained <= 9999999.5 AND marks_obtained * 2 = trunc(marks_obtained * 2))) NOT VALID,
  ADD CONSTRAINT test_subject_scores_marks_within_range
    CHECK (marks_obtained IS NULL OR total_marks IS NULL OR marks_obtained <= total_marks * 2) NOT VALID,
  ADD CONSTRAINT test_subject_scores_score_requires_total
    CHECK (marks_obtained IS NULL OR total_marks IS NOT NULL) NOT VALID;

ALTER TABLE public.test_chapter_links
  ADD CONSTRAINT test_chapter_links_total_marks_integer
    CHECK (total_marks IS NULL OR (total_marks = trunc(total_marks) AND total_marks <= 9999999)) NOT VALID,
  ADD CONSTRAINT test_chapter_links_marks_half_point
    CHECK (marks_obtained IS NULL OR (marks_obtained <= 9999999.5 AND marks_obtained * 2 = trunc(marks_obtained * 2)) ) NOT VALID,
  ADD CONSTRAINT test_chapter_links_marks_within_range
    CHECK (marks_obtained IS NULL OR total_marks IS NULL OR marks_obtained <= total_marks * 2) NOT VALID,
  ADD CONSTRAINT test_chapter_links_score_requires_total
    CHECK (marks_obtained IS NULL OR total_marks IS NOT NULL) NOT VALID;

ALTER TABLE public.weekly_goals
  ADD CONSTRAINT weekly_goals_target_matches_type
    CHECK (
      (goal_type = 'study_hours' AND target BETWEEN 0.5 AND 168 AND target * 2 = trunc(target * 2))
      OR (goal_type <> 'study_hours' AND target BETWEEN 1 AND 999999 AND target = trunc(target))
    ) NOT VALID,
  ADD CONSTRAINT weekly_goals_count_progress_integer
    CHECK (goal_type = 'study_hours' OR progress_value = trunc(progress_value)) NOT VALID;

ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_revision_gaps_valid
    CHECK (
      cardinality(revision_gaps) BETWEEN 1 AND 12
      AND array_ndims(revision_gaps) = 1
      AND array_lower(revision_gaps, 1) = 1
      AND array_position(revision_gaps, NULL::integer) IS NULL
      AND 0 < ALL (revision_gaps)
    ) NOT VALID,
  ADD CONSTRAINT app_settings_daily_goal_minutes_valid
    CHECK (daily_study_goal_minutes BETWEEN 0 AND 1440) NOT VALID;
