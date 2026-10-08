-- "הספרייה המשותפת": parents and teachers share ready-made symbol boards
-- (a category + its words) that anyone can add to their own child in one tap.
--
-- Only words, emoji and ARASAAC pictogram ids are stored here — never personal
-- photos or a child's name. Every signed-in user can read the library; only
-- the author can delete their own board.

create table public.shared_boards (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.users(id) on delete cascade,
  author_name text not null,
  author_role text not null default 'parent' check (author_role in ('parent', 'teacher')),
  title text not null check (char_length(title) between 1 and 60),
  emoji text not null default '📁',
  topic text not null default 'other',
  description text not null default '' check (char_length(description) <= 300),
  -- [{ "label": "סביבון", "emoji": "🪀", "pictogramId": 1234 }, ...]
  symbols_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.shared_board_likes (
  board_id uuid not null references public.shared_boards(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create index shared_boards_created_at_idx on public.shared_boards (created_at desc);

alter table public.shared_boards enable row level security;
alter table public.shared_board_likes enable row level security;

create policy "signed-in users read the library"
on public.shared_boards for select
to authenticated
using (true);

create policy "users share as themselves"
on public.shared_boards for insert
to authenticated
with check (author_id = auth.uid());

create policy "authors delete their own boards"
on public.shared_boards for delete
to authenticated
using (author_id = auth.uid());

create policy "signed-in users read likes"
on public.shared_board_likes for select
to authenticated
using (true);

create policy "users like as themselves"
on public.shared_board_likes for insert
to authenticated
with check (user_id = auth.uid());

create policy "users remove their own like"
on public.shared_board_likes for delete
to authenticated
using (user_id = auth.uid());

notify pgrst, 'reload schema';
