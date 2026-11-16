-- Closes review finding R2-8: one signup could create unlimited workspaces and rows.
-- Written 2026-11-16. APPLIED on the test project evidence-ledger-test only, after the SQL was shown and approved. First run, no errors.
-- Afterwards the v6 test passed 6 of 6 and rolled back.
--
-- Each user can belong to at most 3 workspaces, counted from workspace_members.
-- Why 3: one team, a personal sandbox and a demo. It is one number below, easy to raise later in a new migration.
--
-- How it is enforced:
--   - create_workspace refuses the 4th workspace with a clear message.
--   - A per user advisory lock makes two calls at the same moment line up, so both cannot see "2" and both succeed.
--     The lock is released at the end of the transaction.
--
-- Limits, so nobody thinks this closes more than it does:
--   - It caps workspaces per user, not per person. Someone can still make many accounts. That needs email verification
--     and rate limits in Supabase Auth settings, which this schema cannot set.
--   - It counts memberships. Today membership is only written by create_workspace, so memberships equal workspaces made.
--     When invites exist, being invited would count toward the cap, so the cap must move to a created_by column then.
--   - It does not cap rows inside a workspace. That is a separate decision if abuse ever shows up.

create or replace function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  who uuid := (select auth.uid());
  owned integer;
  max_workspaces constant integer := 3;
begin
  if who is null then
    raise exception 'not signed in';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(who::text, 0));
  select count(*) into owned from public.workspace_members where user_id = who;
  if owned >= max_workspaces then
    raise exception 'workspace limit reached: at most % workspaces per user', max_workspaces using errcode = 'P0001';
  end if;

  insert into public.workspaces (name) values (workspace_name) returning id into new_id;
  insert into public.workspace_members (workspace_id, user_id) values (new_id, who);
  return new_id;
end;
$$;
