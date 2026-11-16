-- Pre-registration lock for ledger_entries. Applied on the test project evidence-ledger-test on 2026-11-15.
-- Closes the gap found by the two-user test: a hypothesis could be edited after registering.
-- Rules enforced by the database, not by the app:
--   1. The server clock stamps registered_at. A value sent by the client is ignored.
--      Without this, someone could backdate a registration to make an entry look confirmatory.
--   2. Once an entry is registered, hypothesis, design, framework_tag and registered_at cannot change.
--   3. Once launched_at is set, it cannot change.
-- Not covered here: deleting a registered entry is still allowed, by decision. The saved test records this as a known limit.

create function public.ledger_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.registered_at is not null and (tg_op = 'INSERT' or old.registered_at is null) then
    new.registered_at := now();
  end if;

  if tg_op = 'UPDATE' and old.registered_at is not null then
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
  end if;

  if tg_op = 'UPDATE' and old.launched_at is not null and new.launched_at is distinct from old.launched_at then
    raise exception 'launched_at is locked once it is set';
  end if;

  return new;
end;
$$;

create trigger ledger_entries_guard
  before insert or update on public.ledger_entries
  for each row execute function public.ledger_entries_guard();
