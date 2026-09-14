-- 주간 PDF 레포트: 과제 주간보고 보완 + 협력사×주차 발행 문서

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
comment on column public.tasks.extras is 'startDate, endDate, goal, asIsProcess, toBeProcess, difficulty, hierarchy, statistics, members, workStatus JSON';

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
