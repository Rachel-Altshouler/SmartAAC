-- Adds a per-child "app state" slot for data that previously lived only in the
-- browser's localStorage: symbol favorites/hidden/core flags, custom symbols
-- and categories, symbol label overrides, family photos, and usage stats.
--
-- Deliberately NOT added as columns on public.children: the existing
-- "care team can update children" policy is keyed only on the single
-- children.caregiver_id column, which a second teacher on the same child
-- does not populate (claim_child_access_code overwrites it per-child, while
-- child_caregivers correctly tracks every linked teacher). A separate table
-- gated by can_access_child() avoids inheriting that gap.

create table public.child_app_state (
  child_id uuid primary key references public.children(id) on delete cascade,
  symbol_settings_json jsonb not null default '{}'::jsonb,
  symbol_images_json jsonb not null default '{}'::jsonb,
  usage_stats_json jsonb not null default '{}'::jsonb,
  has_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.child_app_state enable row level security;

create policy "care team manages app state"
on public.child_app_state for all
using (public.can_access_child(child_id))
with check (public.can_access_child(child_id));

grant execute on function public.can_access_child(uuid) to authenticated;

notify pgrst, 'reload schema';
