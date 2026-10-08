-- Enforce the score's actual denominator at the database boundary.
-- NOT VALID preserves read access to historical rows that need an owner review;
-- PostgreSQL still checks every new row and every updated row. No existing scores
-- are modified or rounded by this migration.

ALTER TABLE public.tests
  DROP CONSTRAINT IF EXISTS tests_valid_marks,
  ADD CONSTRAINT tests_marks_not_over_total
    CHECK (marks_obtained IS NULL OR (total_marks IS NOT NULL AND marks_obtained <= total_marks)) NOT VALID;

ALTER TABLE public.test_subject_scores
  DROP CONSTRAINT IF EXISTS test_subject_scores_marks_within_range,
  ADD CONSTRAINT test_subject_scores_marks_not_over_total
    CHECK (marks_obtained IS NULL OR (total_marks IS NOT NULL AND marks_obtained <= total_marks)) NOT VALID;

ALTER TABLE public.test_chapter_links
  DROP CONSTRAINT IF EXISTS test_chapter_links_marks_within_range,
  ADD CONSTRAINT test_chapter_links_marks_not_over_total
    CHECK (marks_obtained IS NULL OR (total_marks IS NOT NULL AND marks_obtained <= total_marks)) NOT VALID;

NOTIFY pgrst, 'reload schema';
