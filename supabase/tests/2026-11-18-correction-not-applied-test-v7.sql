-- Correction label test, version 7. Run on the TEST project only, never on real data.
-- Written 2026-11-18 for migration 20261118120000_ledger_correction_not_applied.sql.
-- Covers: both check constraints allow not_applied, still allow benjamini_hochberg and exploratory_label so old
-- results stay valid, and still refuse anything else.
-- It reads the constraint definitions and evaluates them. It changes nothing and needs no cleanup.
-- Result: run on the test project on 2026-11-18. Before the migration it failed, 5 of 9 checks passed. After the
-- migration was applied, 9 of 9 passed. Both tables held 0 rows, so no data was touched.
-- The last result row says CORRECTION_V7_PASSED or CORRECTION_V7_FAILED followed by the failures.
-- Limit: this checks the constraint definitions, not an insert through the app's row level security. The app side is
-- covered by the unit tests that record a result with each label.

with defs as (
  select conrelid::regclass::text as table_name, pg_get_constraintdef(oid) as def
  from pg_constraint
  where contype = 'c'
    and conname in ('ledger_entries_correction_method_check', 'ledger_result_versions_correction_method_check')
),
checks as (
  select table_name, 'allows not_applied' as what, def like '%not_applied%' as ok from defs
  union all select table_name, 'still allows benjamini_hochberg', def like '%benjamini_hochberg%' from defs
  union all select table_name, 'still allows exploratory_label', def like '%exploratory_label%' from defs
  union all select table_name, 'allows nothing else', (length(def) - length(replace(def, '::text', ''))) / 6 = 3 from defs
  union all select 'both tables', 'both constraints exist', (select count(*) from defs) = 2
)
select
  case when bool_and(ok) then 'CORRECTION_V7_PASSED'
       else 'CORRECTION_V7_FAILED: ' || string_agg(table_name || ' ' || what, '; ') filter (where not ok) end as result,
  count(*) filter (where ok) || ' of ' || count(*) || ' passed' as passed
from checks;
