-- Privilege check. Read only, safe to run on any project, any time. Written 2026-11-16 for review finding R2-10.
-- It returns one row per problem and no rows when everything is as intended.
-- Run it after every migration and after any change made in the dashboard.
-- Intended state: anon holds nothing in public, authenticated holds no TRUNCATE, REFERENCES or TRIGGER,
-- the append only tables give authenticated no UPDATE or DELETE, and no trigger function is runnable by either role.

select 'anon holds ' || privilege_type || ' on ' || table_name as problem
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
union all
select 'authenticated holds ' || privilege_type || ' on ' || table_name
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
  and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
union all
select 'authenticated holds ' || privilege_type || ' on append only table ' || table_name
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
  and table_name in ('ledger_audit', 'assignments', 'ledger_result_versions')
  and privilege_type in ('UPDATE', 'DELETE')
union all
select 'authenticated can write ' || privilege_type || ' on ' || table_name
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
  and table_name in ('workspaces', 'workspace_members')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
union all
select 'anon can run function ' || p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
union all
select 'authenticated can run trigger function ' || p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')
union all
select 'table without row level security: ' || c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
