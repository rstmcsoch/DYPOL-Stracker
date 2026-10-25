-- Stracker AI (Default) providers report the same connection states as student providers,
-- including insufficient_balance (matches ai_provider_configs_connection_status_check).
alter table public.site_ai_providers drop constraint if exists site_ai_providers_connection_status_check;
alter table public.site_ai_providers add constraint site_ai_providers_connection_status_check
  check (connection_status in ('not_tested','connected','authentication_failed','rate_limited','insufficient_balance','provider_unavailable','model_unavailable','configuration_incomplete','unsupported'));
