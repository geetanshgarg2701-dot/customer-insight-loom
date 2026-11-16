-- Workspace cap test, version 6. Run on the TEST project only, never on real data.
-- Written 2026-11-16 for migration 20261116210000_ledger_workspace_cap.sql (review finding R2-8).
-- Covers: three workspaces are allowed, the fourth is refused with the limit message, the refusal leaves no
-- half made workspace, another user still gets their own three, and a signed out caller is refused.
-- Runs in one transaction that ends in a deliberate error, so it rolls back and leaves nothing behind.
-- The last line raises WORKSPACE_CAP_V6_PASSED_AND_ROLLED_BACK or WORKSPACE_CAP_V6_FAILED.
-- Result: run on the test project on 2026-11-16, 6 of 6 passed and it rolled back, leaving nothing behind.
-- Limit: the advisory lock that stops two simultaneous calls from both passing is not tested here, because a single
-- transaction cannot run two sessions at once.

do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  w uuid;
  n int;
  before_count int;
  passed int := 0;
  fails text[] := '{}';
begin
  insert into auth.users (id, email, aud, role) values
    (ua, 'cap6-a@test.invalid', 'authenticated', 'authenticated'),
    (ub, 'cap6-b@test.invalid', 'authenticated', 'authenticated');

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- W1 three workspaces are allowed
  w := public.create_workspace('one');
  w := public.create_workspace('two');
  w := public.create_workspace('three');
  select count(*) into n from public.workspace_members where user_id = ua;
  if n = 3 then passed := passed + 1; else fails := fails || ('W1 user A holds ' || n || ' memberships'); end if;

  -- W2 the fourth is refused with the limit message
  select count(*) into before_count from public.workspaces;
  begin
    w := public.create_workspace('four');
    fails := array_append(fails, 'W2 a fourth workspace was created');
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'workspace limit reached%' then passed := passed + 1;
    else fails := fails || ('W2 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  -- W3 the refusal left no workspace or membership behind
  select count(*) into n from public.workspaces;
  if n = before_count then passed := passed + 1; else fails := fails || ('W3 workspaces went from ' || before_count || ' to ' || n); end if;
  select count(*) into n from public.workspace_members where user_id = ua;
  if n = 3 then passed := passed + 1; else fails := fails || ('W3 user A holds ' || n || ' memberships after the refusal'); end if;

  -- W4 another user still gets their own three, so the cap is per user, not global
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.create_workspace('b one');
  w := public.create_workspace('b two');
  w := public.create_workspace('b three');
  select count(*) into n from public.workspace_members where user_id = ub;
  if n = 3 then passed := passed + 1; else fails := fails || ('W4 user B holds ' || n || ' memberships'); end if;

  -- W5 a signed out caller is still refused
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    w := public.create_workspace('rogue');
    fails := array_append(fails, 'W5 anon created a workspace');
  exception when others then
    if sqlstate = '42501' then passed := passed + 1; else fails := fails || ('W5 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  reset role;

  if coalesce(array_length(fails, 1), 0) = 0 then
    raise exception 'WORKSPACE_CAP_V6_PASSED_AND_ROLLED_BACK: % checks passed', passed;
  else
    raise exception 'WORKSPACE_CAP_V6_FAILED: % passed, % failed. %', passed, array_length(fails, 1), array_to_string(fails, ' | ');
  end if;
end
$$;
