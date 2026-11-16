-- Row level security, registration lock and integrity test, version 3.
-- Run on the TEST project only, never on real data.
-- Written 2026-11-16 to close review findings R2-1, R2-2, R2-3, R2-4, R2-6, R2-7 and R2-9.
-- Written before the migration 20261116090000_ledger_integrity_fixes.sql. Run on the test project on 2026-11-16:
--   before the migration: 11 passed, 18 failed, which reproduced every database finding from the review
--   after the migration: 29 of 29 passed, and the transaction rolled back, leaving no rows behind
-- The first run also exposed a bug in this test, now fixed: appending a plain string literal to a text array
-- makes Postgres read it as an array literal, so failures were reported as a malformed array error. The
-- fixed version uses array_append, and it is the version that produced the 29 of 29.
--
-- Differences from version 2:
--   1. It fails loudly. Every check compares the exact error code, and the last line raises
--      RLS_V3_PASSED_AND_ROLLED_BACK or RLS_V3_FAILED. A person does not have to read each line.
--   2. It covers the holes found in review: a future launched_at, edits to result and power_result
--      after registration, assignments added after launch, forged audit rows, cross workspace
--      references, raw emails in hash columns.
--
-- Run it BEFORE the migration to see it fail on the old schema, then run it AFTER the migration to see it pass.
-- Everything happens in one transaction that ends in a deliberate error, so it rolls back and leaves
-- no users or rows behind. The error message carries the result.
-- Limit: it sets the user identity in the database directly. It does not test the real sign in flow.

do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  wa uuid; wb uuid;
  ea uuid; eb uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid;
  ta uuid; tb uuid;
  n int;
  ts timestamptz;
  v text;
  actions text;
  h1 text := repeat('a', 64);
  h2 text := repeat('b', 64);
  passed int := 0;
  fails text[] := '{}';
begin
  insert into auth.users (id, email, aud, role) values
    (ua, 'rls3-a@test.invalid', 'authenticated', 'authenticated'),
    (ub, 'rls3-b@test.invalid', 'authenticated', 'authenticated');

  -- setup as user A
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  wa := public.create_workspace('ws A');
  insert into public.ledger_entries (workspace_id, title, hypothesis) values (wa, 'A entry', 'hyp A') returning id into ea;
  insert into public.themes (workspace_id, name, kind, severity, created_by) values (wa, 'A theme', 'pain', 'low', 'human') returning id into ta;
  reset role;

  -- setup as user B
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  wb := public.create_workspace('ws B');
  insert into public.ledger_entries (workspace_id, title, hypothesis) values (wb, 'B entry', 'hyp B') returning id into eb;
  insert into public.themes (workspace_id, name, kind, severity, created_by) values (wb, 'B theme', 'pain', 'low', 'human') returning id into tb;
  reset role;

  -- act as user A from here
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- C1 isolation basics
  select count(*) into n from public.ledger_entries;
  if n = 1 then passed := passed + 1; else fails := fails || ('C1 A sees only own entries, got ' || n); end if;

  update public.ledger_entries set title = 'hacked' where id = eb;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else fails := fails || ('C2 A updated B entry, rows ' || n); end if;

  -- C3 the audit trigger writes a created row with the caller as actor
  select count(*) into n from public.ledger_audit where entry_id = ea and action = 'created' and actor = ua::text;
  if n = 1 then passed := passed + 1; else fails := fails || ('C3 expected one created audit row by A, got ' || n); end if;

  -- C4 a forged audit row is refused (R2-4)
  begin
    insert into public.ledger_audit (workspace_id, entry_id, actor, action, at)
    values (wa, ea, 'someone else', 'registered', now() - interval '30 days');
    fails := array_append(fails, 'C4 forged audit row was allowed');
  exception when others then
    if sqlstate = '42501' then passed := passed + 1; else fails := fails || ('C4 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  -- C5 a future launched_at on insert is replaced by server time (R2-1)
  insert into public.ledger_entries (workspace_id, title, hypothesis, launched_at)
  values (wa, 'future launch', 'placeholder', '2099-01-01') returning id, launched_at into e1, ts;
  if ts < now() + interval '1 minute' then passed := passed + 1; else fails := fails || ('C5 launched_at kept the client value ' || ts); end if;

  -- C6 registering after the launch makes it exploratory, so the hypothesis cannot be written after the results (R2-1)
  perform pg_sleep(0.02);
  update public.ledger_entries set hypothesis = 'written after launch', registered_at = now() where id = e1;
  select entry_type into v from public.ledger_entries where id = e1;
  if v = 'exploratory' then passed := passed + 1; else fails := fails || ('C6 late registration gave ' || coalesce(v, 'null')); end if;

  -- C7 registering first and launching later is confirmatory
  insert into public.ledger_entries (workspace_id, title, hypothesis) values (wa, 'honest order', 'h') returning id into e2;
  update public.ledger_entries set registered_at = now(), status = 'registered' where id = e2;
  perform pg_sleep(0.02);
  update public.ledger_entries set launched_at = now(), status = 'running' where id = e2;
  select entry_type into v from public.ledger_entries where id = e2;
  if v = 'confirmatory' then passed := passed + 1; else fails := fails || ('C7 honest order gave ' || coalesce(v, 'null')); end if;

  -- C8 registering and launching in one statement is exploratory, never confirmatory
  insert into public.ledger_entries (workspace_id, title, hypothesis, registered_at, launched_at, status)
  values (wa, 'same instant', 'h', now(), now(), 'running') returning id into e3;
  select entry_type into v from public.ledger_entries where id = e3;
  if v = 'exploratory' then passed := passed + 1; else fails := fails || ('C8 same instant gave ' || coalesce(v, 'null')); end if;

  -- C9 to C13 locks on the registered entry e2
  begin
    update public.ledger_entries set launched_at = now() - interval '5 days' where id = e2;
    fails := array_append(fails, 'C9 launched_at was edited after it was set');
  exception when others then
    if sqlstate = 'P0001' then passed := passed + 1; else fails := fails || ('C9 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  begin
    update public.ledger_entries set hypothesis = 'changed after registering' where id = e2;
    fails := array_append(fails, 'C10 hypothesis was edited after registering');
  exception when others then
    if sqlstate = 'P0001' then passed := passed + 1; else fails := fails || ('C10 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  begin
    update public.ledger_entries set power_result = '{"pass":true}'::jsonb where id = e2;
    fails := array_append(fails, 'C11 power_result was edited after registering');
  exception when others then
    if sqlstate = 'P0001' then passed := passed + 1; else fails := fails || ('C11 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  begin
    update public.ledger_entries set segment_id = gen_random_uuid() where id = e2;
    fails := array_append(fails, 'C12 segment_id was edited after registering');
  exception when others then
    if sqlstate = 'P0001' then passed := passed + 1; else fails := fails || ('C12 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  begin
    update public.ledger_entries set workspace_id = wb where id = e2;
    fails := array_append(fails, 'C13 entry was moved to another workspace');
  exception when others then
    if sqlstate in ('42501', 'P0001') then passed := passed + 1; else fails := fails || ('C13 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  -- C14 the first result is allowed, the second is refused (R2-2)
  update public.ledger_entries
  set result = '{"lift":0.1}'::jsonb, comparisons_count = 1, correction_method = 'benjamini_hochberg', status = 'readable'
  where id = e2;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else fails := fails || ('C14 first result was refused, rows ' || n); end if;

  begin
    update public.ledger_entries set result = '{"lift":0.9}'::jsonb where id = e2;
    fails := array_append(fails, 'C15 result was overwritten');
  exception when others then
    if sqlstate = 'P0001' then passed := passed + 1; else fails := fails || ('C15 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  begin
    update public.ledger_entries set status = 'running' where id = e2;
    fails := array_append(fails, 'C16 status went backwards');
  exception when others then
    if sqlstate = 'P0001' then passed := passed + 1; else fails := fails || ('C16 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  -- C17 the audit trail was written by the trigger, in order, with no forged rows
  select string_agg(action, ',' order by id) into actions from public.ledger_audit where entry_id = e2;
  if actions = 'created,registered,launched,result_recorded' then passed := passed + 1;
  else fails := fails || ('C17 audit order was ' || coalesce(actions, 'none')); end if;

  -- C18 to C22 assignments (R2-3 and R2-7)
  insert into public.ledger_entries (workspace_id, title, hypothesis) values (wa, 'assign me', 'h') returning id into e4;
  update public.ledger_entries set registered_at = now(), status = 'registered' where id = e4;

  insert into public.assignments (workspace_id, entry_id, customer_email_hash, arm) values (wa, e4, h1, 'treatment');
  select count(*) into n from public.assignments where entry_id = e4;
  if n = 1 then passed := passed + 1; else fails := fails || ('C18 assignment before launch, rows ' || n); end if;

  select count(*) into n from public.ledger_audit where entry_id = e4 and action = 'assigned';
  if n = 1 then passed := passed + 1; else fails := fails || ('C19 expected one assigned audit row, got ' || n); end if;

  begin
    insert into public.assignments (workspace_id, entry_id, customer_email_hash, arm) values (wa, e4, 'jane@example.com', 'control');
    fails := array_append(fails, 'C20 a raw email was stored as a hash');
  exception when others then
    if sqlstate = '23514' then passed := passed + 1; else fails := fails || ('C20 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  update public.ledger_entries set launched_at = now(), status = 'running' where id = e4;
  begin
    insert into public.assignments (workspace_id, entry_id, customer_email_hash, arm) values (wa, e4, h2, 'treatment');
    fails := array_append(fails, 'C21 an assignment was added after launch');
  exception when others then
    if sqlstate = 'P0001' then passed := passed + 1; else fails := fails || ('C21 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  begin
    update public.assignments set arm = 'control' where entry_id = e4;
    get diagnostics n = row_count;
    fails := fails || ('C22 assignments were updated, rows ' || n);
  exception when others then
    if sqlstate = '42501' then passed := passed + 1; else fails := fails || ('C22 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  -- C23 to C27 cross workspace references (R2-6)
  begin
    insert into public.assignments (workspace_id, entry_id, customer_email_hash, arm) values (wa, eb, h1, 'control');
    fails := array_append(fails, 'C23 an assignment pointed at B entry');
  exception when others then
    if sqlstate in ('23503', 'P0001') then passed := passed + 1; else fails := fails || ('C23 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  begin
    insert into public.ledger_citations (workspace_id, entry_id, cited_row_table, cited_row_id)
    values (wa, eb, 'ledger_entries', gen_random_uuid());
    fails := array_append(fails, 'C24 a citation pointed at B entry');
  exception when others then
    if sqlstate = '23503' then passed := passed + 1; else fails := fails || ('C24 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  begin
    update public.ledger_entries set theme_id = tb where id = ea;
    fails := array_append(fails, 'C25 an entry pointed at B theme');
  exception when others then
    if sqlstate = '23503' then passed := passed + 1; else fails := fails || ('C25 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  begin
    insert into public.quotes (workspace_id, theme_id, source_document, redacted_text, redaction_passed_at)
    values (wa, tb, 'doc', 'text', now());
    fails := array_append(fails, 'C26 a quote pointed at B theme');
  exception when others then
    if sqlstate = '23503' then passed := passed + 1; else fails := fails || ('C26 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  begin
    insert into public.record_tags (workspace_id, customer_id, theme_id, source)
    values (wa, 'jane@example.com', ta, 'survey');
    fails := array_append(fails, 'C27 a raw email was stored as a customer id');
  exception when others then
    if sqlstate = '23514' then passed := passed + 1; else fails := fails || ('C27 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;

  -- C28 a signed out caller cannot create a workspace or read entries
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.create_workspace('rogue');
    fails := array_append(fails, 'C28 anon created a workspace');
  exception when others then
    if sqlstate = '42501' then passed := passed + 1; else fails := fails || ('C28 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  begin
    select count(*) into n from public.ledger_entries;
    if n = 0 then passed := passed + 1; else fails := fails || ('C29 anon saw entries, rows ' || n); end if;
  exception when others then
    if sqlstate = '42501' then passed := passed + 1; else fails := fails || ('C29 wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  reset role;

  if coalesce(array_length(fails, 1), 0) = 0 then
    raise exception 'RLS_V3_PASSED_AND_ROLLED_BACK: % checks passed', passed;
  else
    raise exception 'RLS_V3_FAILED: % passed, % failed. %', passed, array_length(fails, 1), array_to_string(fails, ' | ');
  end if;
end
$$;
