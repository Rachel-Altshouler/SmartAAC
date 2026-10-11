-- One code per child, shared by everyone on the child's care team.
--
-- The code is how a parent or teacher joins a child, and everyone who already
-- belongs to the child should see the same code so they can pass it on.
-- Until now only a hash was stored, so a member who joined with the code
-- could never see it again. code_plain keeps the code itself; the existing
-- row-level security ("care team manages access codes", via
-- can_access_child) already limits it to the child's care team.

alter table public.child_access_codes
  add column if not exists code_plain text;

notify pgrst, 'reload schema';
