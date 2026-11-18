-- Allow the correction method not_applied, for a result that made one comparison and so had nothing to correct.
-- Written 2026-11-18. Run on the TEST project only.
--
-- Why: the app wrote benjamini_hochberg on every confirmatory result, but the procedure in src/lib/stats/bh.ts is
-- called nowhere, and a readout makes exactly one comparison. The label claimed a correction that never ran. The app
-- now writes not_applied for that case. benjamini_hochberg stays allowed, because results already saved carry it and
-- because it is the right label once a screen really runs the procedure across several comparisons.
--
-- Effect on data: none. No row is changed. The registration lock and the result version trigger compare the column
-- only on update, and this migration only widens a check, so a locked result stays locked.
-- Names confirmed on the test project on 2026-11-18: ledger_entries_correction_method_check and
-- ledger_result_versions_correction_method_check, both allowing benjamini_hochberg and exploratory_label.

alter table public.ledger_entries
  drop constraint ledger_entries_correction_method_check;
alter table public.ledger_entries
  add constraint ledger_entries_correction_method_check
  check (correction_method in ('benjamini_hochberg', 'exploratory_label', 'not_applied'));

alter table public.ledger_result_versions
  drop constraint ledger_result_versions_correction_method_check;
alter table public.ledger_result_versions
  add constraint ledger_result_versions_correction_method_check
  check (correction_method in ('benjamini_hochberg', 'exploratory_label', 'not_applied'));
