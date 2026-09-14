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

alter table public.tasks
  add column if not exists weekly_detail text not null default '',
  add column if not exists weekly_issues text not null default '';

alter table public.task_weekly_reports
  add column if not exists weekly_detail text not null default '',
  add column if not exists weekly_issues text not null default '',
  add column if not exists work_status text not null default '';

comment on column public.tasks.weekly_detail is '과제별 진행 상세 (선택)';
comment on column public.tasks.weekly_issues is '과제별 금주 이슈 (선택)';
comment on column public.task_weekly_reports.weekly_detail is '해당 주 진행 상세';
comment on column public.task_weekly_reports.weekly_issues is '해당 주 과제 이슈';
comment on column public.task_weekly_reports.work_status is '해당 주 스냅샷 시점의 산출물 작업 상태';

create table if not exists public.company_weekly_reports (
  id text primary key,
  company_id text not null references public.companies (id) on delete cascade,
  week_number integer not null check (week_number >= 1),
  status text not null default 'draft' check (status in ('draft', 'published')),
  title text not null default '',
  subtitle text not null default '',
  period_start date,
  period_end date,
  location text not null default '',
  body jsonb not null default '{}'::jsonb,
  source jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, week_number)
);

create index if not exists company_weekly_reports_company_id_idx
  on public.company_weekly_reports (company_id);

create index if not exists company_weekly_reports_week_number_idx
  on public.company_weekly_reports (week_number);

drop trigger if exists company_weekly_reports_set_updated_at on public.company_weekly_reports;
create trigger company_weekly_reports_set_updated_at
before update on public.company_weekly_reports
for each row execute function public.set_updated_at();

alter table public.company_weekly_reports enable row level security;

revoke all on table public.company_weekly_reports from anon, authenticated;
grant all on table public.company_weekly_reports to service_role;

comment on table public.company_weekly_reports is '협력사×주차 주간 PDF 레포트 초안/발행 문서';

-- 2) 확장 컬럼
alter table public.companies
  add column if not exists extras jsonb not null default '{}'::jsonb;

alter table public.tasks
  add column if not exists extras jsonb not null default '{}'::jsonb;

comment on column public.companies.extras is 'pmo, notices, participantUpdateRequest JSON';
comment on column public.tasks.extras is 'startDate, endDate, goal, asIsProcess, toBeProcess, difficulty, hierarchy, statistics, members, workStatus JSON';
