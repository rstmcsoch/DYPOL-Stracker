-- Close remaining numeric-boundary gaps without rewriting historical user rows.
-- NOT VALID retains read access to old values for review while PostgreSQL enforces
-- these ranges for every new or updated row.

ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_target_score_supported_range
    CHECK (target_score BETWEEN 0 AND 999999.99) NOT VALID;

ALTER TABLE public.weekly_goals
  ADD CONSTRAINT weekly_goals_progress_supported_range
    CHECK (progress_value BETWEEN 0 AND 999999.99) NOT VALID;

NOTIFY pgrst, 'reload schema';
