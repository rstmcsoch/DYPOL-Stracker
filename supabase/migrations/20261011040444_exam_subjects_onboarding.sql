-- Per-exam subjects, onboarding flag, and subject columns that accept any exam's subjects.
--
-- Safety model:
--   * Existing rows are not rewritten. The P/C/M-only checks are replaced by a length check
--     that every existing value ('Physics','Chemistry','Maths') already satisfies, so the new
--     constraints validate without touching data.
--   * exam_catalog keeps forced RLS; new columns only. Seeded subjects are written only where
--     an exam has none yet, so later owner edits are never overwritten by a re-run.
--   * app_settings.onboarding_completed defaults to false; nothing reads it until the
--     onboarding release, and it never blocks the Control Center.
--   * The AI assistant's SQL functions keep their own Physics/Chemistry/Maths checks (unchanged).

alter table public.exam_catalog
  add column if not exists subjects text[] not null default '{}' check (cardinality(subjects) <= 30),
  add column if not exists session_label text not null default '' check (char_length(session_label) <= 30);

alter table public.app_settings
  add column if not exists onboarding_completed boolean not null default false;

alter table public.chapters drop constraint if exists chapters_subject_check;
alter table public.chapters add constraint chapters_subject_check
  check (char_length(btrim(subject)) between 1 and 60);
alter table public.test_subject_scores drop constraint if exists test_subject_scores_subject_check;
alter table public.test_subject_scores add constraint test_subject_scores_subject_check
  check (char_length(btrim(subject)) between 1 and 60);

alter table public.tests drop constraint if exists tests_subject_check;
alter table public.tests add constraint tests_subject_check
  check (subject is null or char_length(btrim(subject)) between 1 and 60);
alter table public.daily_tasks drop constraint if exists daily_tasks_subject_check;
alter table public.daily_tasks add constraint daily_tasks_subject_check
  check (subject is null or char_length(btrim(subject)) between 1 and 60);
alter table public.study_sessions drop constraint if exists study_sessions_subject_check;
alter table public.study_sessions add constraint study_sessions_subject_check
  check (subject is null or char_length(btrim(subject)) between 1 and 60);
alter table public.backlog_items drop constraint if exists backlog_items_subject_check;
alter table public.backlog_items add constraint backlog_items_subject_check
  check (subject is null or char_length(btrim(subject)) between 1 and 60);
alter table public.test_error_logs drop constraint if exists test_error_logs_subject_check;
alter table public.test_error_logs add constraint test_error_logs_subject_check
  check (subject is null or char_length(btrim(subject)) between 1 and 60);
alter table public.test_time_entries drop constraint if exists test_time_entries_subject_check;
alter table public.test_time_entries add constraint test_time_entries_subject_check
  check (subject is null or char_length(btrim(subject)) between 1 and 60);

-- Seed subjects (and Class 11/12 streams) for exams that have none yet.
update public.exam_catalog set subjects = array['Physics', 'Chemistry', 'Maths']::text[], session_label = '' where id = 'jee' and subjects = '{}';
update public.exam_catalog set subjects = array['Physics', 'Chemistry', 'Maths', 'Biology']::text[], session_label = '' where id = 'mht-cet' and subjects = '{}';
update public.exam_catalog set subjects = array['Physics', 'Chemistry', 'Maths', 'Biology', 'English Proficiency', 'Logical Reasoning']::text[], session_label = '' where id = 'bitsat' and subjects = '{}';
update public.exam_catalog set subjects = array['Physics', 'Chemistry', 'Maths', 'Biology', 'Aptitude', 'English']::text[], session_label = '' where id = 'viteee' and subjects = '{}';
update public.exam_catalog set subjects = array['Physics', 'Chemistry', 'Maths']::text[], session_label = '' where id = 'comedk-uget' and subjects = '{}';
update public.exam_catalog set subjects = array['Physics', 'Chemistry', 'Maths']::text[], session_label = '' where id = 'wbjee' and subjects = '{}';
update public.exam_catalog set subjects = array['Physics', 'Chemistry', 'Maths', 'Biology']::text[], session_label = '' where id = 'kcet' and subjects = '{}';
update public.exam_catalog set subjects = array['Physics', 'Chemistry', 'Botany', 'Zoology']::text[], session_label = '' where id = 'neet-ug' and subjects = '{}';
update public.exam_catalog set subjects = array['Language', 'General Aptitude Test', 'Physics', 'Chemistry', 'Maths', 'Biology', 'Accountancy', 'Business Studies', 'Economics', 'History', 'Political Science', 'Geography', 'Psychology', 'Sociology', 'Computer Science']::text[], session_label = '' where id = 'cuet-ug' and subjects = '{}';
update public.exam_catalog set subjects = array['English Language', 'Current Affairs & GK', 'Legal Reasoning', 'Logical Reasoning', 'Quantitative Techniques']::text[], session_label = '' where id = 'clat' and subjects = '{}';
update public.exam_catalog set subjects = array['Maths', 'English', 'General Knowledge']::text[], session_label = '', sessions = case when sessions = '{}' then array['NDA I', 'NDA II']::text[] else sessions end where id = 'nda' and subjects = '{}';
update public.exam_catalog set subjects = array['English', 'Hindi', 'Maths', 'Science', 'Social Science']::text[], session_label = '' where id = 'class-9' and subjects = '{}';
update public.exam_catalog set subjects = array['English', 'Hindi', 'Maths', 'Science', 'Social Science']::text[], session_label = '' where id = 'class-10' and subjects = '{}';
update public.exam_catalog set subjects = array['English', 'Physics', 'Chemistry', 'Maths', 'Biology', 'Accountancy', 'Business Studies', 'Economics', 'History', 'Political Science', 'Geography', 'Psychology', 'Sociology']::text[], session_label = 'Stream', sessions = case when sessions = '{}' then array['Science (PCM)', 'Science (PCB)', 'Science (PCMB)', 'Commerce', 'Humanities']::text[] else sessions end where id = 'class-11' and subjects = '{}';
update public.exam_catalog set subjects = array['English', 'Physics', 'Chemistry', 'Maths', 'Biology', 'Accountancy', 'Business Studies', 'Economics', 'History', 'Political Science', 'Geography', 'Psychology', 'Sociology']::text[], session_label = 'Stream', sessions = case when sessions = '{}' then array['Science (PCM)', 'Science (PCB)', 'Science (PCMB)', 'Commerce', 'Humanities']::text[] else sessions end where id = 'class-12' and subjects = '{}';
update public.exam_catalog set subjects = array['Accounting', 'Business Laws', 'Quantitative Aptitude', 'Business Economics']::text[], session_label = 'Attempt', sessions = case when sessions = '{}' then array['January', 'May', 'September']::text[] else sessions end where id = 'ca-foundation' and subjects = '{}';
update public.exam_catalog set subjects = array['Advanced Accounting', 'Corporate and Other Laws', 'Taxation', 'Cost and Management Accounting', 'Auditing and Ethics', 'Financial Management and Strategic Management']::text[], session_label = 'Attempt', sessions = case when sessions = '{}' then array['January', 'May', 'September']::text[] else sessions end where id = 'ca-intermediate' and subjects = '{}';
update public.exam_catalog set subjects = array['Financial Reporting', 'Advanced Financial Management', 'Advanced Auditing and Professional Ethics', 'Direct Tax Laws and International Taxation', 'Indirect Tax Laws', 'Integrated Business Solutions']::text[], session_label = 'Attempt', sessions = case when sessions = '{}' then array['May', 'November']::text[] else sessions end where id = 'ca-final' and subjects = '{}';
update public.exam_catalog set subjects = array['Jurisprudence, Interpretation and General Laws', 'Company Law and Practice', 'Setting up of Business, Industrial and Labour Laws', 'Corporate Accounting and Financial Management', 'Capital Market and Securities Laws', 'Economic, Commercial and IP Laws', 'Tax Laws and Practice']::text[], session_label = 'Attempt', sessions = case when sessions = '{}' then array['June', 'December']::text[] else sessions end where id = 'cs-executive' and subjects = '{}';
update public.exam_catalog set subjects = array['ESG: Principles and Practice', 'Drafting, Pleadings and Appearances', 'Compliance Management, Audit and Due Diligence', 'Strategic Management and Corporate Finance', 'Corporate Restructuring, Valuation and Insolvency', 'Elective 1', 'Elective 2']::text[], session_label = 'Attempt', sessions = case when sessions = '{}' then array['June', 'December']::text[] else sessions end where id = 'cs-professional' and subjects = '{}';
update public.exam_catalog set subjects = array['Business Laws and Ethics', 'Financial Accounting', 'Direct and Indirect Taxation', 'Cost Accounting', 'Operations and Strategic Management', 'Corporate Accounting and Auditing', 'Financial Management and Business Data Analytics', 'Management Accounting']::text[], session_label = 'Attempt', sessions = case when sessions = '{}' then array['June', 'December']::text[] else sessions end where id = 'cma-intermediate' and subjects = '{}';
update public.exam_catalog set subjects = array['Corporate and Economic Laws', 'Strategic Financial Management', 'Direct Tax Laws and International Taxation', 'Strategic Cost Management', 'Cost and Management Audit', 'Corporate Financial Reporting', 'Indirect Tax Laws and Practice', 'Elective']::text[], session_label = 'Attempt', sessions = case when sessions = '{}' then array['June', 'December']::text[] else sessions end where id = 'cma-final' and subjects = '{}';
update public.exam_catalog set subjects = array['General Aptitude', 'Engineering Maths', 'Core Subject']::text[], session_label = '' where id = 'gate' and subjects = '{}';
update public.exam_catalog set subjects = array['Verbal Ability and Reading Comprehension', 'Data Interpretation and Logical Reasoning', 'Quantitative Ability']::text[], session_label = '' where id = 'cat' and subjects = '{}';
update public.exam_catalog set subjects = array['GS Paper I (Prelims)', 'CSAT (Prelims)', 'Essay', 'GS I', 'GS II', 'GS III', 'GS IV', 'Optional Subject']::text[], session_label = '' where id = 'upsc-cse' and subjects = '{}';
update public.exam_catalog set subjects = array['Quantitative Aptitude', 'Reasoning', 'English', 'General Awareness', 'Computer Knowledge']::text[], session_label = '' where id = 'ssc-cgl' and subjects = '{}';
update public.exam_catalog set subjects = array['English', 'Quantitative Aptitude', 'Reasoning', 'Data Analysis and Interpretation', 'General, Economy and Banking Awareness']::text[], session_label = '' where id = 'ibps-po' and subjects = '{}';
update public.exam_catalog set subjects = array['English', 'Quantitative Aptitude', 'Reasoning and Computer Aptitude', 'Data Analysis and Interpretation', 'General, Economy and Banking Awareness']::text[], session_label = '' where id = 'sbi-po' and subjects = '{}';
