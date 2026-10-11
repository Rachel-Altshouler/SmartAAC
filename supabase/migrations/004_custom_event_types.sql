-- Lets parents/teachers add an event of a type that isn't in the fixed list
-- (e.g. "רופא שיניים" 🦷): event_type 'custom' + its own label and emoji.

alter table public.calendar_events
  drop constraint if exists calendar_events_event_type_check;

alter table public.calendar_events
  add constraint calendar_events_event_type_check
  check (event_type in ('school', 'trip', 'birthday', 'family', 'special', 'custom'));

alter table public.calendar_events
  add column if not exists custom_label text check (custom_label is null or char_length(custom_label) <= 30),
  add column if not exists custom_emoji text check (custom_emoji is null or char_length(custom_emoji) <= 16);

notify pgrst, 'reload schema';
