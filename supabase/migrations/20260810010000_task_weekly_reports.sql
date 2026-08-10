-- 과제×주차 주간 보고 스냅샷

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
