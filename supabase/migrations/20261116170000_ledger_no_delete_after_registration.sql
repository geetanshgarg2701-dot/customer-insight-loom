-- Closes review finding R2-5: deleting an entry cascaded away its audit rows, assignments, citations and result versions.
-- Written 2026-11-16. APPLIED on the test project evidence-ledger-test only, after the SQL was shown and approved. First run, no errors.
--
-- Decision: a registered entry can never be deleted. The ledger only grows once an entry is registered.
-- A draft, which was never registered, can still be deleted, and its audit rows go with it. Nothing was promised yet.
--
-- Effects to know about:
--   - Deleting a whole workspace is refused while it holds any registered entry, because the cascade deletes each entry
--     and this trigger fires for each one. Nothing in the app deletes workspaces today, and direct deletes on
--     workspaces are already revoked for signed in users. A future "delete my workspace" feature must decide this first.
--   - The same holds for deleting an auth user who owns the only membership of a workspace, if that ever cascades.
--   - A service role or database owner can still drop the trigger. This protects against app users and bugs,
--     not against someone with full database access.

create function public.ledger_entries_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.registered_at is not null then
    raise exception 'a registered entry cannot be deleted' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke execute on function public.ledger_entries_no_delete() from public, anon, authenticated;

create trigger ledger_entries_no_delete
  before delete on public.ledger_entries
  for each row execute function public.ledger_entries_no_delete();
