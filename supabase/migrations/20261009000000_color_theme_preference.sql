-- Colour theme preference for the authenticated notebook UI.
-- Additive and backward compatible: existing rows keep 'default', which is the
-- established Stracker palette. The display mode (light/dark/auto) stays in the
-- existing `theme` column; a palette always ships both light and dark variants.

alter table public.app_settings
  add column if not exists color_theme text not null default 'default';

alter table public.app_settings
  drop constraint if exists app_settings_color_theme_valid;

alter table public.app_settings
  add constraint app_settings_color_theme_valid
  check (color_theme in (
    'default', 'sunset-blaze', 'forest-emerald', 'sandalwood', 'ocean-deep',
    'sakura-blossom', 'dracula-midnight', 'lavender-mist', 'cyberpunk-neon'
  ));
