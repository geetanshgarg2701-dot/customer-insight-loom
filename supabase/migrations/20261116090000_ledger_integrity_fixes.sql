-- Ledger integrity fixes, closing review findings R2-1, R2-2, R2-3, R2-4, R2-6 and R2-7.
-- Written 2026-11-16 after the review of 2026-11-16.
-- APPLIED on the test project evidence-ledger-test on 2026-11-16, first run, no errors. Supabase recorded it as
-- version 20261116102225, so this file name and the recorded version differ, as they already do for the two earlier migrations.
-- Not applied anywhere else. Before it, the v3 test passed 11 of 29 checks. After it, 29 of 29.
--
-- What this closes:
--   R2-1  launched_at is stamped by the server, so a future date can no longer make a late registration confirmatory.
--   R2-2  result, power_result, segment_id, journey_id, theme_id are locked at the right moments, and status cannot go backwards.
--   R2-3  assignments cannot be added once an entry has launched.
--   R2-4  audit rows are written only by triggers, with the caller as actor and the server time.
--   R2-6  child rows can only point at a parent in their own workspace.
--   R2-7  hash columns must look like a 64 character hex hash, so a raw email cannot be stored there.
--
-- What this does NOT close, so nobody thinks it does:
--   R2-5  deleting an entry still cascades away its audit rows, assignments and citations.
--   R2-8  one signup can still create unlimited workspaces and rows.
--   R2-10 default table privileges were not reviewed.
--   The database still cannot check that an arm matches the bucket rule, because it does not hold the secret.
--   The database still cannot prove redaction ran, only that a stamp exists.
-- If the test project already holds rows that break a new constraint, the migration stops with an error and changes nothing.

-- 1. Same workspace references (R2-6). Foreign key checks ignore row level security, so the workspace
--    must be part of the key. A child row can then only point at a parent in its own workspace.
alter table public.ledger_entries add constraint ledger_entries_id_workspace_key unique (id, workspace_id);
alter table public.themes add constraint themes_id_workspace_key unique (id, workspace_id);

alter table public.ledger_citations drop constraint if exists ledger_citations_entry_id_fkey;
alter table public.ledger_citations add constraint ledger_citations_entry_fkey
  foreign key (entry_id, workspace_id) references public.ledger_entries (id, workspace_id) on delete cascade;

alter table public.ledger_audit drop constraint if exists ledger_audit_entry_id_fkey;
alter table public.ledger_audit add constraint ledger_audit_entry_fkey
  foreign key (entry_id, workspace_id) references public.ledger_entries (id, workspace_id) on delete cascade;

alter table public.assignments drop constraint if exists assignments_entry_id_fkey;
alter table public.assignments add constraint assignments_entry_fkey
  foreign key (entry_id, workspace_id) references public.ledger_entries (id, workspace_id) on delete cascade;

-- Needs Postgres 15 or newer for the column list on set null. The workspace column must stay set.
alter table public.ledger_entries drop constraint if exists ledger_entries_theme_id_fkey;
alter table public.ledger_entries add constraint ledger_entries_theme_fkey
  foreign key (theme_id, workspace_id) references public.themes (id, workspace_id) on delete set null (theme_id);

alter table public.quotes drop constraint if exists quotes_theme_id_fkey;
alter table public.quotes add constraint quotes_theme_fkey
  foreign key (theme_id, workspace_id) references public.themes (id, workspace_id) on delete cascade;

alter table public.record_tags drop constraint if exists record_tags_theme_id_fkey;
alter table public.record_tags add constraint record_tags_theme_fkey
  foreign key (theme_id, workspace_id) references public.themes (id, workspace_id) on delete cascade;

-- 2. Hash shape (R2-7). Part A section 5.5 says server tables keep a keyed hash, never the raw address.
alter table public.assignments add constraint assignments_hash_shape
  check (customer_email_hash ~ '^[0-9a-f]{64}$');
alter table public.record_tags add constraint record_tags_customer_shape
  check (customer_id ~ '^[0-9a-f]{64}$');

-- 3. The entry guard (R2-1, R2-2).
-- Both times come from clock_timestamp, which moves forward inside a transaction, unlike now.
-- A time sent by the client is ignored. Registering and launching in the same statement gives equal times,
-- and equal times are exploratory, because registration must come strictly before launch.
create or replace function public.ledger_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v timestamptz := clock_timestamp();
  statuses constant text[] := array['draft', 'registered', 'running', 'readable', 'closed'];
begin
  if tg_op = 'INSERT' then
    if new.registered_at is not null then new.registered_at := v; end if;
    if new.launched_at is not null then new.launched_at := v; end if;
  else
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_id cannot change';
    end if;
    if old.registered_at is null and new.registered_at is not null then new.registered_at := v; end if;
    if old.launched_at is null and new.launched_at is not null then new.launched_at := v; end if;

    if old.registered_at is not null then
      if new.registered_at is distinct from old.registered_at then
        raise exception 'registered_at is locked once an entry is registered';
      end if;
      if new.hypothesis is distinct from old.hypothesis then
        raise exception 'hypothesis is locked once an entry is registered';
      end if;
      if new.design is distinct from old.design then
        raise exception 'design is locked once an entry is registered';
      end if;
      if new.framework_tag is distinct from old.framework_tag then
        raise exception 'framework_tag is locked once an entry is registered';
      end if;
      if new.power_result is distinct from old.power_result then
        raise exception 'power_result is locked once an entry is registered';
      end if;
      if new.segment_id is distinct from old.segment_id
         or new.journey_id is distinct from old.journey_id
         or new.theme_id is distinct from old.theme_id then
        raise exception 'segment, journey and theme are locked once an entry is registered';
      end if;
    end if;

    if old.launched_at is not null and new.launched_at is distinct from old.launched_at then
      raise exception 'launched_at is locked once it is set';
    end if;

    -- A result is written once. A later result must be a new version, not an overwrite.
    if old.result is not null then
      if new.result is distinct from old.result
         or new.comparisons_count is distinct from old.comparisons_count
         or new.correction_method is distinct from old.correction_method then
        raise exception 'result is locked once it is recorded';
      end if;
    end if;

    if array_position(statuses, new.status) < array_position(statuses, old.status) then
      raise exception 'status cannot go back';
    end if;
  end if;

  if new.status = 'registered' and new.registered_at is null then
    raise exception 'a registered entry needs a registration time';
  end if;
  if new.status in ('running', 'readable') and new.launched_at is null then
    raise exception 'a launched entry needs a launch time';
  end if;
  return new;
end;
$$;
revoke execute on function public.ledger_entries_guard() from public, anon, authenticated;

-- 4. Assignments close at launch (R2-3). The entry must be in the same workspace, and not yet launched.
create function public.assignments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  e record;
begin
  select launched_at, status into e
  from public.ledger_entries
  where id = new.entry_id and workspace_id = new.workspace_id;
  if not found then
    raise exception 'entry not found in this workspace';
  end if;
  if e.launched_at is not null or e.status not in ('draft', 'registered') then
    raise exception 'assignments are closed once an entry launches';
  end if;
  return new;
end;
$$;
revoke execute on function public.assignments_guard() from public, anon, authenticated;

create trigger assignments_guard
  before insert on public.assignments
  for each row execute function public.assignments_guard();

-- 5. The audit log is written only by triggers (R2-4). The caller is the actor and the server clock is the time.
-- Direct inserts are removed, so the log cannot be forged by a signed in user.
drop policy if exists ledger_audit_insert on public.ledger_audit;
revoke insert on public.ledger_audit from authenticated, anon;

create function public.ledger_entries_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text := coalesce((select auth.uid())::text, 'system');
  logged boolean := false;
begin
  if tg_op = 'INSERT' then
    insert into public.ledger_audit (workspace_id, entry_id, actor, action, "at")
    values (new.workspace_id, new.id, who, 'created', clock_timestamp());
    return null;
  end if;

  if old.registered_at is null and new.registered_at is not null then
    insert into public.ledger_audit (workspace_id, entry_id, actor, action, "at")
    values (new.workspace_id, new.id, who, 'registered', clock_timestamp());
    logged := true;
  end if;
  if old.launched_at is null and new.launched_at is not null then
    insert into public.ledger_audit (workspace_id, entry_id, actor, action, "at")
    values (new.workspace_id, new.id, who, 'launched', clock_timestamp());
    logged := true;
  end if;
  if old.result is null and new.result is not null then
    insert into public.ledger_audit (workspace_id, entry_id, actor, action, "at")
    values (new.workspace_id, new.id, who, 'result_recorded', clock_timestamp());
    logged := true;
  end if;
  if new.status = 'closed' and old.status <> 'closed' then
    insert into public.ledger_audit (workspace_id, entry_id, actor, action, "at")
    values (new.workspace_id, new.id, who, 'closed', clock_timestamp());
    logged := true;
  end if;
  if not logged and new is distinct from old then
    insert into public.ledger_audit (workspace_id, entry_id, actor, action, "at")
    values (new.workspace_id, new.id, who, 'updated', clock_timestamp());
  end if;
  return null;
end;
$$;
revoke execute on function public.ledger_entries_audit() from public, anon, authenticated;

create trigger ledger_entries_audit
  after insert or update on public.ledger_entries
  for each row execute function public.ledger_entries_audit();

-- One audit row per entry for each insert statement of assignments, not one per person.
create function public.assignments_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ledger_audit (workspace_id, entry_id, actor, action, "at")
  select distinct workspace_id, entry_id, coalesce((select auth.uid())::text, 'system'), 'assigned', clock_timestamp()
  from inserted;
  return null;
end;
$$;
revoke execute on function public.assignments_audit() from public, anon, authenticated;

create trigger assignments_audit
  after insert on public.assignments
  referencing new table as inserted
  for each statement execute function public.assignments_audit();
