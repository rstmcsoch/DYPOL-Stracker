-- Adds the insufficient_balance connection status returned when a provider reports exhausted credit
-- or quota. Existing rows are unaffected; the list of allowed values is only widened.
alter table public.ai_provider_configs drop constraint if exists ai_provider_configs_connection_status_check;
alter table public.ai_provider_configs add constraint ai_provider_configs_connection_status_check
  check (connection_status in (
    'not_tested','connected','authentication_failed','rate_limited','insufficient_balance',
    'provider_unavailable','model_unavailable','configuration_incomplete','unsupported'
  ));
