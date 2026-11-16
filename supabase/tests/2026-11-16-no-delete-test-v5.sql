-- No delete after registration test, version 5. Run on the TEST project only, never on real data.
-- Written 2026-11-16 for migration 20261116170000_ledger_no_delete_after_registration.sql (review finding R2-5).
-- Covers: a registered entry cannot be deleted and keeps its audit rows, a draft can be deleted,
-- and a launched entry cannot be deleted either.
-- Runs in one transaction that ends in a deliberate error, so it rolls back and leaves nothing behind.
-- The last line raises NO_DELETE_V5_PASSED_AND_ROLLED_BACK or NO_DELETE_V5_FAILED.
-- Result: run on the test project on 2026-11-16, 6 checks passed (D1 to D5, with D2 counting two) and it rolled back, leaving nothing behind.
-- Run version 4 for everything else. This file only adds the delete checks.

do $$
declare
  ua uuid := gen_random_uuid();
  wa uuid;
  draft uuid; reg uuid; launched uuid;
  n int;
  passed int := 0;
  fails text[] := '{}';
begin
  insert into auth.users (id, email, aud, role) values (ua, 'nodelete5@test.invalid', 'authenticated', 'authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  wa := public.create_workspace('ws delete test');

  insert into public.ledger_entries (workspace_id, title, hypothesis) values (wa, 'draft', 'h') returning id into draft;
  insert into public.ledger_entries (workspace_id, title, hypothesis) values (wa, 'registered', 'h') returning id into reg;
  update public.ledger_entries set registered_at = now(), status = 'registered' where id = reg;
  insert into public.ledger_entries (workspace_id, title, hypothesis) values (wa, 'launched', 'h') returning id into launched;
  update public.ledger_entries set registered_at = now(), status = 'registered' where id = launched;
  perform pg_sleep(0.02);
  update public.ledger_entries set launched_at = now(), status = 'running' where id = launched;

  -- D1 a registered entry cannot be deleted
  begin
    delete from public.ledger_entries where id = reg;
    fails := array_append(fails, 'D1 a registered entry was deleted');
  exception when others then
    if sqlstate = 'P0001' then passed := passed + 1; else fails := fails || ('D1 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  -- D2 the registered entry and its audit rows are still there
  select count(*) into n from public.ledger_entries where id = reg;
  if n = 1 then passed := passed + 1; else fails := fails || ('D2 registered entry rows ' || n); end if;
  select count(*) into n from public.ledger_audit where entry_id = reg;
  if n = 2 then passed := passed + 1; else fails := fails || ('D2 audit rows ' || n); end if;

  -- D3 a launched entry cannot be deleted
  begin
    delete from public.ledger_entries where id = launched;
    fails := array_append(fails, 'D3 a launched entry was deleted');
  exception when others then
    if sqlstate = 'P0001' then passed := passed + 1; else fails := fails || ('D3 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  -- D4 a draft can still be deleted
  delete from public.ledger_entries where id = draft;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else fails := fails || ('D4 draft was not deleted, rows ' || n); end if;

  -- D5 the draft's audit rows went with it, and the others are untouched
  select count(*) into n from public.ledger_audit where entry_id = draft;
  if n = 0 then passed := passed + 1; else fails := fails || ('D5 draft audit rows ' || n); end if;

  reset role;
  if coalesce(array_length(fails, 1), 0) = 0 then
    raise exception 'NO_DELETE_V5_PASSED_AND_ROLLED_BACK: % checks passed', passed;
  else
    raise exception 'NO_DELETE_V5_FAILED: % passed, % failed. %', passed, array_length(fails, 1), array_to_string(fails, ' | ');
  end if;
end
$$;
