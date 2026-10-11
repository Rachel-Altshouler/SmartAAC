-- "מה עשיתי היום": the kindergarten teacher uploads a few photos of the day,
-- the AI writes a sentence in the child's voice for each, and at home the
-- child tells their parents about their day by tapping the photos.
-- One story per child per day; the child's care team reads and writes it.

create table if not exists public.daily_stories (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  story_date date not null default current_date,
  -- [{ "photo": "data:image/jpeg;base64,...", "sentence": "...", "words": [{ "label": "...", "emoji": "...", "symbolId": "..." }] }]
  items_json jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (child_id, story_date)
);

alter table public.daily_stories enable row level security;

drop policy if exists "care team manages daily stories" on public.daily_stories;
create policy "care team manages daily stories"
on public.daily_stories for all
using (public.can_access_child(child_id))
with check (public.can_access_child(child_id));

-- 🔔 a reminder email the day before an event is sent once per event
alter table public.calendar_events
  add column if not exists reminder_sent_at timestamptz;

notify pgrst, 'reload schema';
