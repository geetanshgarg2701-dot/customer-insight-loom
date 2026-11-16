-- Row level security and registration lock test for the evidence ledger schema, version 2.
-- Run on the TEST project only, never on real data.
-- It creates two fake users, acts as each one, and checks what each can and cannot do.
-- Everything happens in one transaction that ends in a deliberate error, so it rolls back
-- and leaves no users or rows behind. The error message carries the results.
-- Expected: every line has got equal to expect, with these lines reading differently:
--   the KNOWN LIMIT line shows rows deleted 1, because deleting a registered entry is allowed by decision,
--   and the signed-out line shows rows visible 0.
-- First run: 2026-11-15, 32 checks, all as expected, after the registration lock was applied.
-- Replaces version 1, whose known gap check no longer applies.
-- Limit: this sets the user identity in the database directly. It does not test the real sign-in flow.

do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  wa uuid; wb uuid; ea uuid; eb uuid; ta uuid; e2 uuid; e3 uuid;
  n int;
  b boolean;
  v text;
  ts timestamptz;
  res jsonb := '[]'::jsonb;
begin
  insert into auth.users (id, email, aud, role) values
    (ua, 'rls-a@test.invalid', 'authenticated', 'authenticated'),
    (ub, 'rls-b@test.invalid', 'authenticated', 'authenticated');

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
  reset role;

  -- now act as user A
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.ledger_entries;
  res := res || jsonb_build_object('test','A sees only own entries','expect','1','got',n::text);
  select count(*) into n from public.workspaces;
  res := res || jsonb_build_object('test','A sees only own workspace','expect','1','got',n::text);
  select count(*) into n from public.workspace_members;
  res := res || jsonb_build_object('test','A sees only own membership rows','expect','1','got',n::text);
  select public.is_workspace_member(wb) into b;
  res := res || jsonb_build_object('test','A is member of B workspace','expect','false','got',b::text);

  begin
    insert into public.ledger_entries (workspace_id, title, hypothesis) values (wb, 'x', 'x');
    res := res || jsonb_build_object('test','A inserts entry into B workspace','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A inserts entry into B workspace','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  update public.ledger_entries set title = 'hacked' where id = eb;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('test','A updates B entry, rows changed','expect','0','got',n::text);

  delete from public.ledger_entries where id = eb;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('test','A deletes B entry, rows deleted','expect','0','got',n::text);

  begin
    update public.ledger_entries set workspace_id = wb where id = ea;
    get diagnostics n = row_count;
    res := res || jsonb_build_object('test','A moves own entry into B workspace','expect','blocked','got','rows changed: ' || n::text);
  exception when others then
    res := res || jsonb_build_object('test','A moves own entry into B workspace','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    insert into public.workspace_members (workspace_id, user_id) values (wb, ua);
    res := res || jsonb_build_object('test','A adds self to B workspace','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A adds self to B workspace','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    insert into public.workspaces (name) values ('rogue');
    res := res || jsonb_build_object('test','A inserts workspace directly','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A inserts workspace directly','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    insert into public.ledger_audit (workspace_id, entry_id, actor, action) values (wa, ea, 'test', 'created');
    res := res || jsonb_build_object('test','A appends audit row in own workspace','expect','allowed','got','allowed');
  exception when others then
    res := res || jsonb_build_object('test','A appends audit row in own workspace','expect','allowed','got','blocked: ' || sqlerrm);
  end;

  begin
    insert into public.ledger_audit (workspace_id, entry_id, actor, action) values (wb, eb, 'test', 'forged');
    res := res || jsonb_build_object('test','A appends audit row in B workspace','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A appends audit row in B workspace','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    update public.ledger_audit set action = 'edited';
    res := res || jsonb_build_object('test','A updates audit row','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A updates audit row','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    delete from public.ledger_audit;
    res := res || jsonb_build_object('test','A deletes audit row','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A deletes audit row','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    insert into public.quotes (workspace_id, theme_id, source_document, redacted_text, redaction_passed_at) values (wa, ta, 'doc', 'text', null);
    res := res || jsonb_build_object('test','Quote without redaction stamp','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','Quote without redaction stamp','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    insert into public.quotes (workspace_id, theme_id, source_document, redacted_text, redaction_passed_at) values (wa, ta, 'doc', 'text', now());
    res := res || jsonb_build_object('test','Quote with redaction stamp','expect','allowed','got','allowed');
  exception when others then
    res := res || jsonb_build_object('test','Quote with redaction stamp','expect','allowed','got','blocked: ' || sqlerrm);
  end;

  begin
    insert into public.quotes (workspace_id, theme_id, source_document, redacted_text, redaction_passed_at) values (wb, ta, 'doc', 'text', now());
    res := res || jsonb_build_object('test','Quote written into B workspace','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','Quote written into B workspace','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    insert into public.assignments (workspace_id, entry_id, customer_email_hash, arm) values (wa, ea, 'hash1', 'treatment');
    update public.assignments set arm = 'control';
    res := res || jsonb_build_object('test','A reshuffles an assignment','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A reshuffles an assignment','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    update public.ledger_entries set entry_type = 'confirmatory' where id = ea;
    res := res || jsonb_build_object('test','A edits entry_type by hand','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A edits entry_type by hand','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  -- drafts stay editable
  insert into public.ledger_entries (workspace_id, title, hypothesis) values (wa, 'draft entry', 'first wording') returning id into e3;
  update public.ledger_entries set hypothesis = 'second wording' where id = e3;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('test','A edits hypothesis of an unregistered draft','expect','1','got',n::text);

  -- server stamps registration time
  insert into public.ledger_entries (workspace_id, title, hypothesis, registered_at) values (wa, 'backdated', 'h', now() - interval '10 days') returning registered_at into ts;
  res := res || jsonb_build_object('test','Backdated registered_at on insert is replaced by server time','expect','true','got',(ts >= now() - interval '1 minute')::text);

  update public.ledger_entries set registered_at = now() - interval '10 days', launched_at = now() + interval '1 day' where id = ea;
  select registered_at into ts from public.ledger_entries where id = ea;
  res := res || jsonb_build_object('test','Backdated registered_at on update is replaced by server time','expect','true','got',(ts >= now() - interval '1 minute')::text);

  select entry_type into v from public.ledger_entries where id = ea;
  res := res || jsonb_build_object('test','entry_type when registered before launch','expect','confirmatory','got',coalesce(v,'null'));

  insert into public.ledger_entries (workspace_id, title, hypothesis, launched_at) values (wa, 'late registration', 'h', now() - interval '1 day') returning id into e2;
  update public.ledger_entries set registered_at = now() where id = e2;
  select entry_type into v from public.ledger_entries where id = e2;
  res := res || jsonb_build_object('test','entry_type when registered after launch','expect','exploratory','got',coalesce(v,'null'));

  -- the lock, on the registered entry ea
  begin
    update public.ledger_entries set hypothesis = 'changed after registering' where id = ea;
    res := res || jsonb_build_object('test','A edits hypothesis after registering','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A edits hypothesis after registering','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    update public.ledger_entries set design = '{"split":0.5}'::jsonb where id = ea;
    res := res || jsonb_build_object('test','A edits design after registering','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A edits design after registering','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    update public.ledger_entries set framework_tag = 'PAS' where id = ea;
    res := res || jsonb_build_object('test','A edits framework_tag after registering','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A edits framework_tag after registering','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    update public.ledger_entries set registered_at = now() - interval '30 days' where id = ea;
    res := res || jsonb_build_object('test','A edits registered_at after registering','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A edits registered_at after registering','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  begin
    update public.ledger_entries set launched_at = now() - interval '5 days' where id = ea;
    res := res || jsonb_build_object('test','A edits launched_at once set','expect','blocked','got','ALLOWED');
  exception when others then
    res := res || jsonb_build_object('test','A edits launched_at once set','expect','blocked','got','blocked: ' || sqlerrm);
  end;

  update public.ledger_entries set title = 'renamed', result = '{"lift":0.1}'::jsonb, status = 'running' where id = ea;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('test','A still edits title, result and status after registering','expect','1','got',n::text);

  -- known limit, decided: a registered entry can be deleted
  delete from public.ledger_entries where id = ea;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('test','KNOWN LIMIT: A deletes a registered entry','expect','allowed by decision','got','rows deleted: ' || n::text);

  reset role;

  -- signed out caller
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    select count(*) into n from public.ledger_entries;
    res := res || jsonb_build_object('test','Signed-out caller reads entries','expect','0 rows or blocked','got','rows visible: ' || n::text);
  exception when others then
    res := res || jsonb_build_object('test','Signed-out caller reads entries','expect','0 rows or blocked','got','blocked: ' || sqlerrm);
  end;
  reset role;

  raise exception 'RLS_RESULTS_ROLLED_BACK: %', res::text;
end
$$;
