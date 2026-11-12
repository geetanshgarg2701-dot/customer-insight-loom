-- Evidence ledger schema v1.
-- Applied on the test project evidence-ledger-test on 2026-11-12, first run, no errors.
-- Source: Part B sections 6.1, 6.2 and 6.4. Items marked INFERRED are additions, not in Part B.
-- Not yet tested with two real users, so the row level security policies are unproven.

-- Workspaces and membership. INFERRED: Part B names workspace_id as the row level security key
-- but does not define the table behind it, and row level security needs something to check against.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- Membership check used by every policy. Security definer so the check itself does not hit row level security.
create function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;

-- The only way to create a workspace. The caller becomes its first member.
create function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in';
  end if;
  insert into public.workspaces (name) values (workspace_name) returning id into new_id;
  insert into public.workspace_members (workspace_id, user_id) values (new_id, (select auth.uid()));
  return new_id;
end;
$$;
revoke execute on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

-- Part B 6.4: themes
create table public.themes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null,
  kind text not null check (kind in ('job', 'pain', 'gain')),
  severity text not null check (severity in ('low', 'medium', 'high')),
  created_by text not null check (created_by in ('ai', 'human')),
  corrected_by_human boolean not null default false
);
create index themes_workspace_id_idx on public.themes (workspace_id);

-- Part B 6.1: ledger_entries
-- Enums from Part B are written as text with check constraints. Same rules, easier to change later.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  title text not null,
  hypothesis text not null,
  registered_at timestamptz,
  launched_at timestamptz,
  -- Computed by the database, so it cannot be edited by hand.
  -- INFERRED: Part B defines it only as confirmatory when registered_at is earlier than launched_at, else exploratory.
  -- It stays null until both timestamps exist, because before launch there is nothing to compare.
  entry_type text generated always as (
    case
      when registered_at is null or launched_at is null then null
      when registered_at < launched_at then 'confirmatory'
      else 'exploratory'
    end
  ) stored,
  theme_id uuid references public.themes on delete set null,
  segment_id uuid,
  journey_id uuid,
  framework_tag text check (framework_tag in ('PAS', 'FAB', 'AIDA')),
  design jsonb,
  power_result jsonb,
  result jsonb,
  comparisons_count integer check (comparisons_count >= 0),
  correction_method text check (correction_method in ('benjamini_hochberg', 'exploratory_label')),
  status text not null default 'draft' check (status in ('draft', 'registered', 'running', 'readable', 'closed'))
);
create index ledger_entries_workspace_id_idx on public.ledger_entries (workspace_id);
create index ledger_entries_theme_id_idx on public.ledger_entries (theme_id);

-- Part B 6.1: ledger_citations. INFERRED: id column added.
create table public.ledger_citations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  entry_id uuid not null references public.ledger_entries on delete cascade,
  cited_row_table text not null,
  cited_row_id uuid not null,
  created_at timestamptz not null default now()
);
create index ledger_citations_workspace_id_idx on public.ledger_citations (workspace_id);
create index ledger_citations_entry_id_idx on public.ledger_citations (entry_id);

-- Part B 6.1: ledger_audit, append only. INFERRED: id column added, actor kept as text so it can say ai or a user id.
create table public.ledger_audit (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  entry_id uuid not null references public.ledger_entries on delete cascade,
  actor text not null,
  action text not null,
  at timestamptz not null default now()
);
create index ledger_audit_workspace_id_idx on public.ledger_audit (workspace_id);
create index ledger_audit_entry_id_idx on public.ledger_audit (entry_id);

-- Part B 6.4: quotes.
-- redaction_passed_at is NOT NULL, which is the constraint Part B asks for.
-- Limit: the database can see that a stamp exists, not that redaction really ran.
-- The proof that redaction ran lives in the TypeScript branded type and the run time check.
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  theme_id uuid not null references public.themes on delete cascade,
  source_document text not null,
  redacted_text text not null,
  consent_flag boolean not null default false,
  redaction_passed_at timestamptz not null
);
create index quotes_workspace_id_idx on public.quotes (workspace_id);
create index quotes_theme_id_idx on public.quotes (theme_id);

-- Part B 6.4: record_tags. INFERRED: customer_id is text because Part B uses hashed emails as customer keys.
create table public.record_tags (
  workspace_id uuid not null references public.workspaces on delete cascade,
  customer_id text not null,
  theme_id uuid not null references public.themes on delete cascade,
  source text not null check (source in ('survey', 'review', 'ticket', 'note')),
  tagged_at timestamptz not null default now(),
  primary key (workspace_id, customer_id, theme_id, source)
);
create index record_tags_theme_id_idx on public.record_tags (theme_id);

-- Part B 6.2: assignments. INFERRED: Part B names the table and its fields in prose only.
-- Insert only, so a re-run cannot reshuffle who is in which group.
create table public.assignments (
  workspace_id uuid not null references public.workspaces on delete cascade,
  entry_id uuid not null references public.ledger_entries on delete cascade,
  customer_email_hash text not null,
  arm text not null check (arm in ('treatment', 'control')),
  assigned_at timestamptz not null default now(),
  primary key (entry_id, customer_email_hash)
);
create index assignments_workspace_id_idx on public.assignments (workspace_id);

-- Row level security on every table.
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.themes enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.ledger_citations enable row level security;
alter table public.ledger_audit enable row level security;
alter table public.quotes enable row level security;
alter table public.record_tags enable row level security;
alter table public.assignments enable row level security;

-- Workspaces and membership: read only for members. Writes go through create_workspace.
create policy workspaces_select on public.workspaces
  for select to authenticated
  using ((select public.is_workspace_member(id)));

create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Full access for members on the tables people edit.
do $$
declare
  t text;
begin
  foreach t in array array['themes', 'ledger_entries', 'ledger_citations', 'quotes', 'record_tags']
  loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_workspace_member(workspace_id)))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_workspace_member(workspace_id)))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_workspace_member(workspace_id))) with check ((select public.is_workspace_member(workspace_id)))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_workspace_member(workspace_id)))', t || '_delete', t);
  end loop;
end
$$;

-- Append only tables: read and insert for members, nothing else.
do $$
declare
  t text;
begin
  foreach t in array array['ledger_audit', 'assignments']
  loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_workspace_member(workspace_id)))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_workspace_member(workspace_id)))', t || '_insert', t);
  end loop;
end
$$;

-- Belt and braces: no direct writes to membership, no update or delete on the append only tables.
revoke insert, update, delete on public.workspaces from authenticated, anon;
revoke insert, update, delete on public.workspace_members from authenticated, anon;
revoke update, delete on public.ledger_audit from authenticated, anon;
revoke update, delete on public.assignments from authenticated, anon;
