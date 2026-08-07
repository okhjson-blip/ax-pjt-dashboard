-- =============================================================================
-- Supabase SQL Editor에 한 번에 붙여넣어 실행하세요.
-- 프로젝트: winryyfctskibaajdyxv
-- =============================================================================

-- 1) 초기 스키마
create extension if not exists pgcrypto;

create table if not exists public.companies (
  id text primary key,
  name text not null,
  start_date date,
  kickoff_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id text primary key,
  company_id text not null references public.companies (id) on delete cascade,
  name text not null,
  email text not null,
  dept text not null default '',
  status text not null default '정상' check (status in ('정상', '정체')),
  summary text not null default '',
  next_week_plan text not null default '',
  instructor_memo text not null default '',
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email)
);

create table if not exists public.tasks (
  id text primary key,
  participant_id text not null references public.participants (id) on delete cascade,
  name text not null,
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  weekly_summary text not null default '',
  next_week_plan text not null default '',
  instructor_feedback text not null default '',
  report_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_meta (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists participants_company_id_idx on public.participants (company_id);
create index if not exists participants_email_idx on public.participants (lower(email));
create index if not exists tasks_participant_id_idx on public.tasks (participant_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

drop trigger if exists participants_set_updated_at on public.participants;
create trigger participants_set_updated_at
before update on public.participants
for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists app_meta_set_updated_at on public.app_meta;
create trigger app_meta_set_updated_at
before update on public.app_meta
for each row execute function public.set_updated_at();

alter table public.companies enable row level security;
alter table public.participants enable row level security;
alter table public.tasks enable row level security;
alter table public.app_meta enable row level security;

revoke all on table public.companies from anon, authenticated;
revoke all on table public.participants from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;
revoke all on table public.app_meta from anon, authenticated;

grant all on table public.companies to service_role;
grant all on table public.participants to service_role;
grant all on table public.tasks to service_role;
grant all on table public.app_meta to service_role;

-- 2) 확장 컬럼
alter table public.companies
  add column if not exists extras jsonb not null default '{}'::jsonb;

alter table public.tasks
  add column if not exists extras jsonb not null default '{}'::jsonb;

comment on column public.companies.extras is 'pmo, notices, participantUpdateRequest JSON';
comment on column public.tasks.extras is 'startDate, endDate, goal, asIsProcess, toBeProcess, difficulty JSON';
