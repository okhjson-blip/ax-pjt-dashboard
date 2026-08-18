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

-- 3) 과제×주차 주간 보고 스냅샷
create table if not exists public.task_weekly_reports (
  id text primary key,
  task_id text not null references public.tasks (id) on delete cascade,
  week_number integer not null check (week_number >= 1),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  weekly_summary text not null default '',
  next_week_plan text not null default '',
  instructor_feedback text not null default '',
  report_completed boolean not null default false,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, week_number)
);

create index if not exists task_weekly_reports_task_id_idx
  on public.task_weekly_reports (task_id);

create index if not exists task_weekly_reports_week_number_idx
  on public.task_weekly_reports (week_number);

drop trigger if exists task_weekly_reports_set_updated_at on public.task_weekly_reports;
create trigger task_weekly_reports_set_updated_at
before update on public.task_weekly_reports
for each row execute function public.set_updated_at();

alter table public.task_weekly_reports enable row level security;

revoke all on table public.task_weekly_reports from anon, authenticated;
grant all on table public.task_weekly_reports to service_role;

comment on table public.task_weekly_reports is '과제별 컨설팅 주차 주간보고 스냅샷';

-- 2) 확장 컬럼
alter table public.companies
  add column if not exists extras jsonb not null default '{}'::jsonb;

alter table public.tasks
  add column if not exists extras jsonb not null default '{}'::jsonb;

comment on column public.companies.extras is 'pmo, notices, participantUpdateRequest JSON';
comment on column public.tasks.extras is 'startDate, endDate, goal, asIsProcess, toBeProcess, difficulty, hierarchy, statistics, members JSON';
