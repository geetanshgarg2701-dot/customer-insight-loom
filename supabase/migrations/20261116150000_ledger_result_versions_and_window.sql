-- Result versions and the fixed horizon window, for the Supabase pilot schema.
-- Written 2026-11-16. APPLIED on the test project evidence-ledger-test only, after the SQL was shown and approved.
-- The first run left out the grant at the end of this file. The guard triggers run as the signed in user, so they
-- must be allowed to call ledger_readout_is_open. The v4 test caught it on its first run, and the grant was applied
-- as a second migration, ledger_readout_helper_grant. The grant is now part of this file, so a fresh project is right.
--
-- Brings the database in line with the app (src/lib/ledger/window.ts and the ledger_result_versions table):
--   1. A result unlocks only after launched_at plus the conversion window in design. Before that the database
--      refuses a first result and any new version. The closing instant counts as inside the window, so the
--      readout opens just after it. This is the fixed horizon rule, plan section 6.2.
--   2. Later results are new rows in ledger_result_versions with a reason, never an overwrite.
--      The table is append only, numbered 1, 2, 3 with no gaps, and stamped by the server.
--
-- Window source: design ->> 'conversionWindowHours', a number above 0 and at most 8760, which is one year.
-- A design without a usable window can launch but can never record a result. The app refuses the same way.
--
-- What this does NOT do:
--   - It does not stop a person from choosing a very short window. That is a design choice, visible in the
--     registered design, which is locked after registration.
--   - It cannot prove the numbers in a result came from the data. It only controls when and how often.
--   - Entry level result stays the first result, locked as before. Later versions live only in the new table.
-- If the test project holds an entry that already has a result without a window, this migration changes nothing
-- for that row, because the check runs only when a result is written.

-- 1. The window check, one function used by the guard and by the versions trigger.
create function public.ledger_readout_is_open(p_launched_at timestamptz, p_design jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  hours numeric;
begin
  if p_launched_at is null or p_design is null or jsonb_typeof(p_design) <> 'object' then
    return false;
  end if;
  if jsonb_typeof(p_design -> 'conversionWindowHours') <> 'number' then
    return false;
  end if;
  hours := (p_design ->> 'conversionWindowHours')::numeric;
  if hours <= 0 or hours > 8760 then
    return false;
  end if;
  return clock_timestamp() > p_launched_at + (hours * interval '1 hour');
end;
$$;
revoke execute on function public.ledger_readout_is_open(timestamptz, jsonb) from public, anon, authenticated;

-- 2. The entry guard gets the window check. Everything else in it is kept as in 20261116090000.
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
    if new.result is not null then
      raise exception 'a result cannot be written when an entry is created';
    end if;
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

    if old.result is not null then
      if new.result is distinct from old.result
         or new.comparisons_count is distinct from old.comparisons_count
         or new.correction_method is distinct from old.correction_method then
        raise exception 'result is locked once it is recorded';
      end if;
    elsif new.result is not null then
      -- The first result. The fixed horizon rule: not before the conversion window closes.
      if not public.ledger_readout_is_open(new.launched_at, new.design) then
        raise exception 'the readout is locked until the conversion window closes' using errcode = 'P0001';
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

-- 3. Result versions. Append only. Numbered from 1 without gaps, stamped by the server.
create table public.ledger_result_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  entry_id uuid not null,
  version integer not null check (version >= 1),
  recorded_at timestamptz not null default clock_timestamp(),
  actor text not null,
  reason text not null check (btrim(reason) <> ''),
  result jsonb not null,
  comparisons_count integer not null check (comparisons_count >= 0),
  correction_method text not null check (correction_method in ('benjamini_hochberg', 'exploratory_label')),
  unique (entry_id, version),
  foreign key (entry_id, workspace_id) references public.ledger_entries (id, workspace_id) on delete cascade
);
create index ledger_result_versions_workspace_id_idx on public.ledger_result_versions (workspace_id);

alter table public.ledger_result_versions enable row level security;

create policy ledger_result_versions_select on public.ledger_result_versions
  for select to authenticated
  using ((select public.is_workspace_member(workspace_id)));

create policy ledger_result_versions_insert on public.ledger_result_versions
  for insert to authenticated
  with check ((select public.is_workspace_member(workspace_id)));

revoke update, delete on public.ledger_result_versions from authenticated, anon;

-- The server sets the actor, the time and the next version number. The client values are ignored.
-- The entry row is locked first, so two people recording at once get versions 1 and 2, never two 1s.
create function public.ledger_result_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  e record;
  latest integer;
begin
  select launched_at, design, status into e
  from public.ledger_entries
  where id = new.entry_id and workspace_id = new.workspace_id
  for update;
  if not found then
    raise exception 'entry not found in this workspace';
  end if;
  if e.status not in ('running', 'readable') then
    raise exception 'a result can only be recorded for a launched, open entry';
  end if;
  if not public.ledger_readout_is_open(e.launched_at, e.design) then
    raise exception 'the readout is locked until the conversion window closes' using errcode = 'P0001';
  end if;

  select coalesce(max(version), 0) into latest from public.ledger_result_versions where entry_id = new.entry_id;
  new.version := latest + 1;
  new.recorded_at := clock_timestamp();
  new.actor := coalesce((select auth.uid())::text, 'system');
  return new;
end;
$$;
revoke execute on function public.ledger_result_versions_guard() from public, anon, authenticated;

create trigger ledger_result_versions_guard
  before insert on public.ledger_result_versions
  for each row execute function public.ledger_result_versions_guard();

-- The audit log gets one row per version, written by a trigger like the others.
create function public.ledger_result_versions_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ledger_audit (workspace_id, entry_id, actor, action, "at")
  values (new.workspace_id, new.entry_id, new.actor, 'result_version_recorded', clock_timestamp());
  return null;
end;
$$;
revoke execute on function public.ledger_result_versions_audit() from public, anon, authenticated;

create trigger ledger_result_versions_audit
  after insert on public.ledger_result_versions
  for each row execute function public.ledger_result_versions_audit();

-- 4. The guard triggers run as the signed in user, so that user must be able to call the helper.
-- The helper only compares the server clock with a date, so it reveals nothing.
grant execute on function public.ledger_readout_is_open(timestamptz, jsonb) to authenticated;
