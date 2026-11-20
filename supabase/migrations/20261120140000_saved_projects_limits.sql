-- Raises the saved project limits, after measuring: the synthetic demo ledger export is 2.65 MB (13,254 assignment rows at
-- about 200 bytes each), so the first limit of 2 MB would refuse a ledger of about 10,000 assigned customers.
-- Written 2026-11-20. New limits: 10 MB per project, 10 projects per workspace, so a workspace holds at most 100 MB of
-- the 500 MB free plan. Both are still starting defaults, not measured needs. The stored size is smaller than the text
-- size because the database compresses large values, which has not been measured here.
-- Applied on the test project evidence-ledger-test only, on 2026-11-20, after the owner said to go ahead with these numbers.
-- Test v9 passed 20 of 20 afterwards, and the security advisor showed only the two intentional warnings.

alter table public.saved_projects drop constraint saved_projects_file_check1;
alter table public.saved_projects add constraint saved_projects_file_size_check check (octet_length(file::text) <= 10000000);

create or replace function public.saved_projects_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  held integer;
  max_projects constant integer := 10;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text, 2));
  select count(*) into held from public.saved_projects where workspace_id = new.workspace_id;
  if held >= max_projects then
    raise exception 'project limit reached: at most % saved projects per workspace', max_projects using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.saved_projects_cap() from public, anon, authenticated;
