-- Saved projects test, version 9. Run on the TEST project only, never on real data.
-- Written 2026-11-20 for migration 20261120100000_saved_projects.sql.
-- Covers: a member saves and reads a project, another user sees none of it and can change or delete none of it, a
-- non-member cannot insert into someone else's workspace, a signed out caller has no access, a forged created_by is
-- refused, an email shaped string and an oversize file are refused, a duplicate name is refused, the 11th project is
-- refused while another workspace is unaffected, a project cannot move workspace, the updated time is set by the
-- database, and a member can delete.
-- Runs in one transaction that ends in a deliberate error, so it rolls back and leaves nothing behind.
-- The last line raises SAVED_PROJECTS_V9_PASSED_AND_ROLLED_BACK or SAVED_PROJECTS_V9_FAILED.
-- Result: run on the test project on 2026-11-20 after migration 20261120140000, SAVED_PROJECTS_V9_PASSED_AND_ROLLED_BACK (20 of 20). Limits tested: 10 MB per project, 10 projects per workspace.
-- Limit: the advisory lock that stops two simultaneous inserts from both passing is not tested here, because a single
-- transaction cannot run two sessions at once.

do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  wa uuid;
  wb uuid;
  p uuid;
  n int;
  t1 timestamptz;
  t2 timestamptz;
  passed int := 0;
  fails text[] := '{}';
begin
  insert into auth.users (id, email, aud, role) values
    (ua, 'sp8-a@test.invalid', 'authenticated', 'authenticated'),
    (ub, 'sp8-b@test.invalid', 'authenticated', 'authenticated');

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  wa := public.create_workspace('sp8 workspace a');
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  wb := public.create_workspace('sp8 workspace b');

  -- P1 a member saves a project and reads it back
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  insert into public.saved_projects (workspace_id, name, file) values (wa, 'first', '{"entries": []}') returning id into p;
  select count(*) into n from public.saved_projects where workspace_id = wa;
  if n = 1 then passed := passed + 1; else fails := array_append(fails, 'P1 member sees ' || n || ' projects'); end if;

  -- P2 created_by is the caller
  select count(*) into n from public.saved_projects where id = p and created_by = ua;
  if n = 1 then passed := passed + 1; else fails := array_append(fails, 'P2 created_by is not the caller'); end if;

  -- P3 another user sees nothing, and changes and deletes nothing
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  select count(*) into n from public.saved_projects;
  if n = 0 then passed := passed + 1; else fails := array_append(fails, 'P3 other user sees ' || n || ' projects'); end if;
  update public.saved_projects set name = 'taken' where id = p;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else fails := array_append(fails, 'P4 other user updated a project'); end if;
  delete from public.saved_projects where id = p;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else fails := array_append(fails, 'P5 other user deleted a project'); end if;

  -- P6 a non-member cannot insert into someone else's workspace
  begin
    insert into public.saved_projects (workspace_id, name, file) values (wa, 'intruder', '{}');
    fails := array_append(fails, 'P6 a non-member inserted');
  exception when others then
    passed := passed + 1;
  end;

  -- P7 a forged created_by is refused
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  begin
    insert into public.saved_projects (workspace_id, name, file, created_by) values (wa, 'forged', '{}', ub);
    fails := array_append(fails, 'P7 a forged created_by was accepted');
  exception when others then
    passed := passed + 1;
  end;

  -- P8 an email shaped string is refused, in a value and in a key
  begin
    insert into public.saved_projects (workspace_id, name, file) values (wa, 'mail one', '{"note": "write to someone@example.com"}');
    fails := array_append(fails, 'P8a an email in a value was accepted');
  exception when others then
    passed := passed + 1;
  end;
  begin
    insert into public.saved_projects (workspace_id, name, file) values (wa, 'mail two', '{"a.b@c.de": 1}');
    fails := array_append(fails, 'P8b an email in a key was accepted');
  exception when others then
    passed := passed + 1;
  end;

  -- P9 an oversize file is refused
  begin
    insert into public.saved_projects (workspace_id, name, file) values (wa, 'big', jsonb_build_object('pad', repeat('x', 10000001)));
    fails := array_append(fails, 'P9 an oversize file was accepted');
  exception when others then
    passed := passed + 1;
  end;

  -- P10 a file that is not an object is refused
  begin
    insert into public.saved_projects (workspace_id, name, file) values (wa, 'array', '[1,2]');
    fails := array_append(fails, 'P10 a file that is not an object was accepted');
  exception when others then
    passed := passed + 1;
  end;

  -- P11 a duplicate name in one workspace is refused
  begin
    insert into public.saved_projects (workspace_id, name, file) values (wa, 'first', '{}');
    fails := array_append(fails, 'P11 a duplicate name was accepted');
  exception when others then
    passed := passed + 1;
  end;

  -- P12 the 11th project is refused with the limit message, and user B's workspace is unaffected
  for i in 2..10 loop
    insert into public.saved_projects (workspace_id, name, file) values (wa, 'p' || i, '{}');
  end loop;
  begin
    insert into public.saved_projects (workspace_id, name, file) values (wa, 'eleven', '{}');
    fails := array_append(fails, 'P12 an 11th project was accepted');
  exception when others then
    if sqlerrm like 'project limit reached%' then passed := passed + 1; else fails := array_append(fails, 'P12 wrong error: ' || sqlerrm); end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  insert into public.saved_projects (workspace_id, name, file) values (wb, 'mine', '{}');
  select count(*) into n from public.saved_projects;
  if n = 1 then passed := passed + 1; else fails := array_append(fails, 'P13 user B sees ' || n || ' projects'); end if;

  -- P14 a project cannot move to another workspace, and who saved it cannot change
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  select updated_at into t1 from public.saved_projects where id = p;
  begin
    update public.saved_projects set workspace_id = wb where id = p;
    fails := array_append(fails, 'P14a a project moved workspace');
  exception when others then
    passed := passed + 1;
  end;
  begin
    update public.saved_projects set created_by = ub where id = p;
    fails := array_append(fails, 'P14b created_by was changed');
  exception when others then
    passed := passed + 1;
  end;

  -- P15 the updated time is set by the database, and a caller cannot set it
  perform pg_sleep(0.05);
  update public.saved_projects set file = '{"entries": [1]}', updated_at = '2000-01-01' where id = p;
  select updated_at into t2 from public.saved_projects where id = p;
  -- now() is fixed for the whole transaction, so the new time equals the creation time here. What this proves is that the
  -- caller's 2000 date was thrown away and the database's own time was used.
  if t2 >= t1 and t2 > '2020-01-01' then passed := passed + 1; else fails := array_append(fails, 'P15 updated_at was not set by the database'); end if;

  -- P16 a member deletes
  delete from public.saved_projects where id = p;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else fails := array_append(fails, 'P16 a member could not delete'); end if;

  -- P17 a signed out caller has no access
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  begin
    perform count(*) from public.saved_projects;
    fails := array_append(fails, 'P17a a signed out caller could read');
  exception when others then
    passed := passed + 1;
  end;
  begin
    insert into public.saved_projects (workspace_id, name, file) values (wa, 'anon', '{}');
    fails := array_append(fails, 'P17b a signed out caller could insert');
  exception when others then
    passed := passed + 1;
  end;
  reset role;

  if array_length(fails, 1) is null and passed = 20 then
    raise exception 'SAVED_PROJECTS_V9_PASSED_AND_ROLLED_BACK (% of 20)', passed;
  else
    raise exception 'SAVED_PROJECTS_V9_FAILED: passed % of 20. %', passed, array_to_string(fails, '; ');
  end if;
end
$$;
