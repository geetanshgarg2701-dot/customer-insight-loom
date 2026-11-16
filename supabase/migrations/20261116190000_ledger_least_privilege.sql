-- Closes review finding R2-10: default table privileges were never reviewed.
-- Written 2026-11-16. APPLIED on the test project evidence-ledger-test only, after the SQL was shown and approved. First run, no errors.
-- Afterwards the privilege check returned no rows, and the v4 test (39 of 39) and v5 test (6 of 6) still passed.
--
-- What the read-only check of 2026-11-16 found on the test project:
--   1. Every public table gave the anon role (signed out visitors) SELECT, plus INSERT, UPDATE and DELETE on five
--      tables, only held back by row level security. Nothing in the app signs out visitors in to the database.
--   2. anon and authenticated both held TRUNCATE on every public table. TRUNCATE is not checked by row level security
--      and fires no row triggers. Over the REST API it is not reachable, but a direct connection as either role could
--      empty ledger_audit, which is meant to be append only.
--   3. authenticated also held REFERENCES and TRIGGER on every table, which signed in users never need.
--   4. New tables, functions and sequences created in public would again start with those wide grants, because the
--      default privileges for the postgres role hand them to anon and authenticated.
-- Not a finding: no function was runnable by anon, and the two runnable by authenticated are on purpose.
--
-- After this migration:
--   anon: no access to any public table, function or sequence.
--   authenticated: only the INSERT, SELECT, UPDATE and DELETE rights granted before, no TRUNCATE, REFERENCES or TRIGGER.
--   New objects created by the postgres role in public start with no rights for anon and no TRUNCATE for authenticated.
--
-- Limits:
--   - Default privileges set by the supabase_admin role are not changed here. Migrations run as postgres and cannot
--     alter them. Objects made through the dashboard as supabase_admin may still start wide, so run the privilege query
--     in supabase/tests/2026-11-16-privilege-check.sql after any dashboard change.
--   - The service role is untouched. It bypasses row level security by design, so its key must never reach the browser.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

revoke truncate, references, trigger on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;
