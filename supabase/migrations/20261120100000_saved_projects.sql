-- Saved projects for pilot accounts, plan 13.1. One saved project is the ledger export file the Ledger screen already
-- makes: entries, results and assignment hashes, never an email address. Stored as one document per project.
-- Written 2026-11-20. Applied on 2026-11-20 to the test project evidence-ledger-test only, after the owner
-- saw this SQL and approved it. The apply ran with no errors, and test v8 passed (20 of 20).
--
-- Rules, matching the rest of the schema:
--   - Row level security on, with the workspace membership check every other table uses. Members read, add, change and
--     delete their workspace's projects. Nobody else sees a row, and a signed out visitor has no access at all.
--   - created_by is the signed in user and cannot be forged. Deleting an account deletes its projects, which is what
--     the delete all my data control needs.
--   - A project file is capped at 2 MB, and a workspace at 20 projects, so one account cannot fill the 500 MB free plan.
--     Both numbers are starting defaults, not measured limits.
--   - A file that holds anything shaped like an email address is refused, as a second line of defense behind the app's
--     own rule that the file holds hashes only.
--
-- Limits, so nobody thinks this closes more than it does:
--   - The email check is a pattern, not proof. An address written in a way the pattern misses would pass.
--   - It does not stop a member from saving a file with misleading contents. The file is their own data.
--   - The service role bypasses row level security by design, so its key must never reach the browser.

create table public.saved_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  file jsonb not null
    check (jsonb_typeof(file) = 'object')
    check (octet_length(file::text) <= 2000000)
    check (file::text !~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}'),
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create index saved_projects_workspace_id_idx on public.saved_projects (workspace_id);

alter table public.saved_projects enable row level security;

create policy saved_projects_select on public.saved_projects
  for select to authenticated
  using ((select public.is_workspace_member(workspace_id)));

create policy saved_projects_insert on public.saved_projects
  for insert to authenticated
  with check ((select public.is_workspace_member(workspace_id)) and created_by = (select auth.uid()));

create policy saved_projects_update on public.saved_projects
  for update to authenticated
  using ((select public.is_workspace_member(workspace_id)))
  with check ((select public.is_workspace_member(workspace_id)));

create policy saved_projects_delete on public.saved_projects
  for delete to authenticated
  using ((select public.is_workspace_member(workspace_id)));

-- Privileges: nothing for signed out visitors, and only the four row rights for signed in users.
revoke all on public.saved_projects from public, anon;
grant select, insert, update, delete on public.saved_projects to authenticated;

-- A workspace holds at most 20 saved projects. An advisory lock per workspace makes two simultaneous inserts line up,
-- so both cannot see 19 and both succeed. The lock is released at the end of the transaction.
create function public.saved_projects_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  held integer;
  max_projects constant integer := 20;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text, 2));
  select count(*) into held from public.saved_projects where workspace_id = new.workspace_id;
  if held >= max_projects then
    raise exception 'project limit reached: at most % saved projects per workspace', max_projects using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger saved_projects_cap_trigger
  before insert on public.saved_projects
  for each row execute function public.saved_projects_cap();

-- On change: a project cannot move to another workspace or change who made it, and its updated time is set here, not by
-- the caller.
create function public.saved_projects_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id <> old.workspace_id then
    raise exception 'a saved project cannot move to another workspace' using errcode = 'P0001';
  end if;
  if new.created_by <> old.created_by then
    raise exception 'who saved a project cannot be changed' using errcode = 'P0001';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger saved_projects_touch_trigger
  before update on public.saved_projects
  for each row execute function public.saved_projects_touch();

revoke execute on function public.saved_projects_cap() from public, anon, authenticated;
revoke execute on function public.saved_projects_touch() from public, anon, authenticated;
