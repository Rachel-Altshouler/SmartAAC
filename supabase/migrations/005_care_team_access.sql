-- Everyone on a child's care team gets the same access: the person who
-- created the profile AND everyone who joined later with the access code.
--
-- Older databases have a version of can_access_child() that only knows the
-- creator (children.parent_id / caregiver_id). A parent or teacher who joined
-- with a code was then refused ("אין הרשאה") when saving photos, settings or
-- events, so the two sides never saw each other's changes.

create or replace function public.can_access_child(child_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.children c
    where c.id = child_uuid
      and (
        c.parent_id = auth.uid()
        or c.caregiver_id = auth.uid()
        or exists (
          select 1
          from public.child_caregivers cc
          where cc.child_id = c.id and cc.caregiver_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.can_access_child(uuid) to authenticated;

-- Joined members can also see the child's profile row (name, level).
drop policy if exists "care team reads children" on public.children;
create policy "care team reads children"
on public.children for select
using (public.can_access_child(id));

notify pgrst, 'reload schema';
