-- AI 프로젝트 통합 대시보드 초기 스키마

create extension if not exists pgcrypto;

create table public.companies (
  id text primary key,
  name text not null,
  start_date date,
  kickoff_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.participants (
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

create table public.tasks (
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

create table public.app_meta (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index participants_company_id_idx on public.participants (company_id);
create index participants_email_idx on public.participants (lower(email));
create index tasks_participant_id_idx on public.tasks (participant_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create trigger participants_set_updated_at
before update on public.participants
for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create trigger app_meta_set_updated_at
before update on public.app_meta
for each row execute function public.set_updated_at();

alter table public.companies enable row level security;
alter table public.participants enable row level security;
alter table public.tasks enable row level security;
alter table public.app_meta enable row level security;

-- anon/authenticated 직접 접근 차단. 서버는 service_role로 RLS 우회.
-- Auth 연동 후 app_metadata.role 기반 policy를 추가한다.

revoke all on table public.companies from anon, authenticated;
revoke all on table public.participants from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;
revoke all on table public.app_meta from anon, authenticated;

grant all on table public.companies to service_role;
grant all on table public.participants to service_role;
grant all on table public.tasks to service_role;
grant all on table public.app_meta to service_role;
