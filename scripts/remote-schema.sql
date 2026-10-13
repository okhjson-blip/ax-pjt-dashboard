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


-- 3) 동시 저장 가드 (apply_dashboard_changes)

-- 동시 저장: 항목 단위 병합, 필드별 이전 값 비교, 없는 행은 실패.
-- security invoker. anon/authenticated 실행 권한은 제거한다.

create or replace function public.item_key(item jsonb, kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when kind = 'id' then coalesce(item->>'id', '')
    else coalesce(
      nullif(lower(btrim(coalesce(item->>'email', ''))), ''),
      'name:' || lower(btrim(coalesce(item->>'name', '')))
    )
  end;
$$;

create or replace function public.apply_keyed_ops(items jsonb, ops jsonb, kind text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  item jsonb;
  cur jsonb;
  result jsonb := coalesce(items, '[]'::jsonb);
  i int;
  base_is_null boolean;
begin
  for item in select value from jsonb_array_elements(coalesce(ops->'delete', '[]'::jsonb))
  loop
    i := 0;
    while i < jsonb_array_length(result) loop
      cur := result->i;
      if public.item_key(cur, kind) = coalesce(item->>'id', '') then
        if cur is distinct from item->'base' then
          raise exception 'conflict' using errcode = 'P0001';
        end if;
        result := result - i;
        exit;
      end if;
      i := i + 1;
    end loop;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(ops->'upsert', '[]'::jsonb))
  loop
    base_is_null := item->'base' is null or jsonb_typeof(item->'base') = 'null';
    i := 0;
    while i < coalesce(jsonb_array_length(result), 0) loop
      cur := result->i;
      if public.item_key(cur, kind) = public.item_key(item->'value', kind) then
        if base_is_null then
          if cur is distinct from item->'value' then
            raise exception 'conflict' using errcode = 'P0001';
          end if;
        elsif cur is distinct from item->'base' then
          raise exception 'conflict' using errcode = 'P0001';
        else
          result := jsonb_set(result, array[i::text], item->'value', false);
        end if;
        i := -1;
        exit;
      end if;
      i := i + 1;
    end loop;
    if i >= 0 then
      if base_is_null then
        result := coalesce(result, '[]'::jsonb) || jsonb_build_array(item->'value');
      else
        raise exception 'conflict' using errcode = 'P0001';
      end if;
    end if;
  end loop;
  return coalesce(result, '[]'::jsonb);
end;
$$;

create or replace function public.apply_dashboard_changes(p_changes jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  rec jsonb;
  c public.companies%rowtype;
  p public.participants%rowtype;
  t public.tasks%rowtype;
  w public.task_weekly_reports%rowtype;
  sets jsonb;
  extras jsonb;
  bucket jsonb;
  spec jsonb;
  k text;
  task_text_keys text[] := array[
    'startDate', 'endDate', 'goal', 'asIsProcess', 'toBeProcess', 'difficulty', 'workStatus',
    'projectName', 'bdwSummary', 'bdwDetail', 'aiFit', 'asIsProcessDetail'
  ];
begin
  for rec in select value from jsonb_array_elements(coalesce(p_changes->'weeklyReports'->'deleted', '[]'::jsonb))
  loop
    delete from public.task_weekly_reports
    where task_id = rec->>'taskId' and week_number = (rec->>'weekNumber')::int;
  end loop;
  if jsonb_array_length(coalesce(p_changes->'tasks'->'deleted', '[]'::jsonb)) > 0 then
    delete from public.tasks
    where id in (select jsonb_array_elements_text(p_changes->'tasks'->'deleted'));
  end if;
  if jsonb_array_length(coalesce(p_changes->'participants'->'deleted', '[]'::jsonb)) > 0 then
    delete from public.participants
    where id in (select jsonb_array_elements_text(p_changes->'participants'->'deleted'));
  end if;
  if jsonb_array_length(coalesce(p_changes->'companies'->'deleted', '[]'::jsonb)) > 0 then
    delete from public.companies
    where id in (select jsonb_array_elements_text(p_changes->'companies'->'deleted'));
  end if;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'companies'->'created', '[]'::jsonb))
  loop
    insert into public.companies (id, name, start_date, kickoff_date, end_date, extras)
    values (
      rec->>'id',
      coalesce(rec->>'name', ''),
      nullif(rec->'schedule'->>'startDate', '')::date,
      nullif(rec->'schedule'->>'kickoffDate', '')::date,
      nullif(rec->'schedule'->>'endDate', '')::date,
      jsonb_build_object(
        'pmo', coalesce(rec->'pmo', '{"members":[]}'::jsonb),
        'notices', coalesce(rec->'notices', '[]'::jsonb),
        'participantUpdateRequest', coalesce(rec->'participantUpdateRequest', '{}'::jsonb)
      )
    )
    on conflict (id) do update set
      name = excluded.name,
      start_date = excluded.start_date,
      kickoff_date = excluded.kickoff_date,
      end_date = excluded.end_date,
      extras = excluded.extras;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'participants'->'created', '[]'::jsonb))
  loop
    insert into public.participants (
      id, company_id, name, email, dept, status, summary, next_week_plan, instructor_memo, registered_at
    ) values (
      rec->>'id',
      rec->>'companyId',
      coalesce(rec->>'name', ''),
      coalesce(rec->>'email', ''),
      coalesce(rec->>'dept', ''),
      coalesce(nullif(rec->>'status', ''), '정상'),
      coalesce(rec->>'summary', ''),
      coalesce(rec->>'nextWeekPlan', ''),
      coalesce(rec->>'instructorMemo', ''),
      nullif(rec->>'registeredAt', '')::timestamptz
    )
    on conflict (id) do update set
      company_id = excluded.company_id,
      name = excluded.name,
      email = excluded.email,
      dept = excluded.dept,
      status = excluded.status,
      summary = excluded.summary,
      next_week_plan = excluded.next_week_plan,
      instructor_memo = excluded.instructor_memo,
      registered_at = excluded.registered_at;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'tasks'->'created', '[]'::jsonb))
  loop
    insert into public.tasks (
      id, participant_id, name, progress, weekly_summary, weekly_detail, weekly_issues,
      next_week_plan, instructor_feedback, report_completed, extras
    ) values (
      rec->>'id',
      rec->>'participantId',
      coalesce(rec->>'name', ''),
      coalesce((rec->>'progress')::int, 0),
      coalesce(rec->>'weeklySummary', ''),
      coalesce(rec->>'weeklyDetail', ''),
      coalesce(rec->>'weeklyIssues', ''),
      coalesce(rec->>'nextWeekPlan', ''),
      coalesce(rec->>'instructorFeedback', ''),
      coalesce((rec->>'reportCompleted')::boolean, false),
      jsonb_build_object(
        'startDate', coalesce(rec->>'startDate', ''),
        'endDate', coalesce(rec->>'endDate', ''),
        'goal', coalesce(rec->>'goal', ''),
        'asIsProcess', coalesce(rec->>'asIsProcess', ''),
        'toBeProcess', coalesce(rec->>'toBeProcess', ''),
        'difficulty', coalesce(nullif(rec->>'difficulty', ''), '중'),
        'workStatus', coalesce(nullif(rec->>'workStatus', ''), '개발'),
        'hierarchy', coalesce(rec->'hierarchy', '{"l1":"","l2":"","l3":"","l4":""}'::jsonb),
        'statistics', coalesce(rec->'statistics', '{}'::jsonb),
        'members', coalesce(rec->'members', '[]'::jsonb),
        'projectName', coalesce(rec->>'projectName', ''),
        'bdwSummary', coalesce(rec->>'bdwSummary', ''),
        'bdwDetail', coalesce(rec->>'bdwDetail', ''),
        'aiFit', coalesce(rec->>'aiFit', ''),
        'asIsProcessDetail', coalesce(rec->>'asIsProcessDetail', '')
      )
    )
    on conflict (id) do update set
      participant_id = excluded.participant_id,
      name = excluded.name,
      progress = excluded.progress,
      weekly_summary = excluded.weekly_summary,
      weekly_detail = excluded.weekly_detail,
      weekly_issues = excluded.weekly_issues,
      next_week_plan = excluded.next_week_plan,
      instructor_feedback = excluded.instructor_feedback,
      report_completed = excluded.report_completed,
      extras = excluded.extras;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'weeklyReports'->'created', '[]'::jsonb))
  loop
    insert into public.task_weekly_reports (
      id, task_id, week_number, progress, weekly_summary, weekly_detail, weekly_issues,
      next_week_plan, instructor_feedback, work_status, report_completed, saved_at
    ) values (
      coalesce(nullif(rec->>'id', ''), 'twr-' || (rec->>'taskId') || '-w' || (rec->>'weekNumber')),
      rec->>'taskId',
      (rec->>'weekNumber')::int,
      coalesce((rec->>'progress')::int, 0),
      coalesce(rec->>'weeklySummary', ''),
      coalesce(rec->>'weeklyDetail', ''),
      coalesce(rec->>'weeklyIssues', ''),
      coalesce(rec->>'nextWeekPlan', ''),
      coalesce(rec->>'instructorFeedback', ''),
      coalesce(rec->>'workStatus', ''),
      coalesce((rec->>'reportCompleted')::boolean, false),
      coalesce(nullif(rec->>'savedAt', '')::timestamptz, now())
    )
    on conflict (task_id, week_number) do update set
      progress = excluded.progress,
      weekly_summary = excluded.weekly_summary,
      weekly_detail = excluded.weekly_detail,
      weekly_issues = excluded.weekly_issues,
      next_week_plan = excluded.next_week_plan,
      instructor_feedback = excluded.instructor_feedback,
      work_status = excluded.work_status,
      report_completed = excluded.report_completed,
      saved_at = excluded.saved_at;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'companies'->'updated', '[]'::jsonb))
  loop
    select * into c from public.companies where id = rec->>'id' for update;
    if not found then raise exception 'missing' using errcode = 'P0001'; end if;
    sets := coalesce(rec->'sets', '{}'::jsonb);
    extras := coalesce(c.extras, '{}'::jsonb);
    if sets ? 'name' then
      if coalesce(c.name, '') is distinct from coalesce(sets->'name'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      c.name := coalesce(sets->'name'->>'value', '');
    end if;
    if sets ? 'schedule' then
      if coalesce(c.start_date::text, '') is distinct from coalesce(sets->'schedule'->'base'->>'startDate', '')
        or coalesce(c.kickoff_date::text, '') is distinct from coalesce(sets->'schedule'->'base'->>'kickoffDate', '')
        or coalesce(c.end_date::text, '') is distinct from coalesce(sets->'schedule'->'base'->>'endDate', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      c.start_date := nullif(sets->'schedule'->'value'->>'startDate', '')::date;
      c.kickoff_date := nullif(sets->'schedule'->'value'->>'kickoffDate', '')::date;
      c.end_date := nullif(sets->'schedule'->'value'->>'endDate', '')::date;
    end if;
    if sets ? 'participantUpdateRequest' then
      if coalesce(extras->'participantUpdateRequest', 'null'::jsonb)
        is distinct from coalesce(sets->'participantUpdateRequest'->'base', 'null'::jsonb) then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      extras := jsonb_set(
        extras,
        '{participantUpdateRequest}',
        coalesce(sets->'participantUpdateRequest'->'value', '{}'::jsonb),
        true
      );
    end if;
    if rec ? 'noticeOps' then
      extras := jsonb_set(extras, '{notices}', public.apply_keyed_ops(extras->'notices', rec->'noticeOps', 'id'), true);
    end if;
    if rec ? 'pmoOps' then
      extras := jsonb_set(
        extras,
        '{pmo,members}',
        public.apply_keyed_ops(coalesce(extras->'pmo'->'members', '[]'::jsonb), rec->'pmoOps', 'email'),
        true
      );
    end if;
    update public.companies
    set name = c.name, start_date = c.start_date, kickoff_date = c.kickoff_date, end_date = c.end_date, extras = extras
    where id = c.id;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'participants'->'updated', '[]'::jsonb))
  loop
    select * into p from public.participants where id = rec->>'id' for update;
    if not found then raise exception 'missing' using errcode = 'P0001'; end if;
    sets := coalesce(rec->'sets', '{}'::jsonb);
    if sets ? 'companyId' then
      if p.company_id is distinct from coalesce(sets->'companyId'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.company_id := sets->'companyId'->>'value';
    end if;
    if sets ? 'name' then
      if coalesce(p.name, '') is distinct from coalesce(sets->'name'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.name := coalesce(sets->'name'->>'value', '');
    end if;
    if sets ? 'email' then
      if coalesce(p.email, '') is distinct from coalesce(sets->'email'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.email := coalesce(sets->'email'->>'value', '');
    end if;
    if sets ? 'dept' then
      if coalesce(p.dept, '') is distinct from coalesce(sets->'dept'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.dept := coalesce(sets->'dept'->>'value', '');
    end if;
    if sets ? 'status' then
      if coalesce(p.status, '') is distinct from coalesce(sets->'status'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.status := coalesce(sets->'status'->>'value', '정상');
    end if;
    if sets ? 'summary' then
      if coalesce(p.summary, '') is distinct from coalesce(sets->'summary'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.summary := coalesce(sets->'summary'->>'value', '');
    end if;
    if sets ? 'nextWeekPlan' then
      if coalesce(p.next_week_plan, '') is distinct from coalesce(sets->'nextWeekPlan'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.next_week_plan := coalesce(sets->'nextWeekPlan'->>'value', '');
    end if;
    if sets ? 'instructorMemo' then
      if coalesce(p.instructor_memo, '') is distinct from coalesce(sets->'instructorMemo'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.instructor_memo := coalesce(sets->'instructorMemo'->>'value', '');
    end if;
    update public.participants
    set company_id = p.company_id, name = p.name, email = p.email, dept = p.dept, status = p.status,
        summary = p.summary, next_week_plan = p.next_week_plan, instructor_memo = p.instructor_memo
    where id = p.id;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'tasks'->'updated', '[]'::jsonb))
  loop
    select * into t from public.tasks where id = rec->>'id' for update;
    if not found then raise exception 'missing' using errcode = 'P0001'; end if;
    sets := coalesce(rec->'sets', '{}'::jsonb);
    extras := coalesce(t.extras, '{}'::jsonb);
    if sets ? 'participantId' then
      if t.participant_id is distinct from coalesce(sets->'participantId'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.participant_id := sets->'participantId'->>'value';
    end if;
    if sets ? 'name' then
      if coalesce(t.name, '') is distinct from coalesce(sets->'name'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.name := coalesce(sets->'name'->>'value', '');
    end if;
    if sets ? 'progress' then
      if t.progress is distinct from coalesce((sets->'progress'->>'base')::int, 0) then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.progress := coalesce((sets->'progress'->>'value')::int, 0);
    end if;
    if sets ? 'weeklySummary' then
      if coalesce(t.weekly_summary, '') is distinct from coalesce(sets->'weeklySummary'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.weekly_summary := coalesce(sets->'weeklySummary'->>'value', '');
    end if;
    if sets ? 'weeklyDetail' then
      if coalesce(t.weekly_detail, '') is distinct from coalesce(sets->'weeklyDetail'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.weekly_detail := coalesce(sets->'weeklyDetail'->>'value', '');
    end if;
    if sets ? 'weeklyIssues' then
      if coalesce(t.weekly_issues, '') is distinct from coalesce(sets->'weeklyIssues'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.weekly_issues := coalesce(sets->'weeklyIssues'->>'value', '');
    end if;
    if sets ? 'nextWeekPlan' then
      if coalesce(t.next_week_plan, '') is distinct from coalesce(sets->'nextWeekPlan'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.next_week_plan := coalesce(sets->'nextWeekPlan'->>'value', '');
    end if;
    if sets ? 'instructorFeedback' then
      if coalesce(t.instructor_feedback, '') is distinct from coalesce(sets->'instructorFeedback'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.instructor_feedback := coalesce(sets->'instructorFeedback'->>'value', '');
    end if;
    if sets ? 'reportCompleted' then
      if t.report_completed is distinct from coalesce((sets->'reportCompleted'->>'base')::boolean, false) then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.report_completed := coalesce((sets->'reportCompleted'->>'value')::boolean, false);
    end if;
    foreach k in array task_text_keys loop
      if sets ? k then
        if coalesce(extras->>k, '') is distinct from coalesce(sets->k->>'base', '') then
          raise exception 'conflict' using errcode = 'P0001';
        end if;
        extras := jsonb_set(extras, array[k], to_jsonb(coalesce(sets->k->>'value', '')), true);
      end if;
    end loop;
    if rec ? 'hierOps' then
      bucket := coalesce(extras->'hierarchy', '{}'::jsonb);
      for k, spec in select key, value from jsonb_each(coalesce(rec->'hierOps'->'sets', '{}'::jsonb))
      loop
        if coalesce(bucket->k, 'null'::jsonb) is distinct from coalesce(spec->'base', 'null'::jsonb) then
          raise exception 'conflict' using errcode = 'P0001';
        end if;
        if spec->'value' is null or jsonb_typeof(spec->'value') = 'null' then
          bucket := bucket - k;
        else
          bucket := jsonb_set(bucket, array[k], spec->'value', true);
        end if;
      end loop;
      extras := jsonb_set(extras, '{hierarchy}', bucket, true);
    end if;
    if rec ? 'statOps' then
      bucket := coalesce(extras->'statistics', '{}'::jsonb);
      for k, spec in select key, value from jsonb_each(coalesce(rec->'statOps'->'sets', '{}'::jsonb))
      loop
        if coalesce(bucket->k, 'null'::jsonb) is distinct from coalesce(spec->'base', 'null'::jsonb) then
          raise exception 'conflict' using errcode = 'P0001';
        end if;
        if spec->'value' is null or jsonb_typeof(spec->'value') = 'null' then
          bucket := bucket - k;
        else
          bucket := jsonb_set(bucket, array[k], spec->'value', true);
        end if;
      end loop;
      extras := jsonb_set(extras, '{statistics}', bucket, true);
    end if;
    if rec ? 'memberOps' then
      extras := jsonb_set(extras, '{members}', public.apply_keyed_ops(extras->'members', rec->'memberOps', 'email'), true);
    end if;
    update public.tasks
    set participant_id = t.participant_id, name = t.name, progress = t.progress,
        weekly_summary = t.weekly_summary, weekly_detail = t.weekly_detail, weekly_issues = t.weekly_issues,
        next_week_plan = t.next_week_plan, instructor_feedback = t.instructor_feedback,
        report_completed = t.report_completed, extras = extras
    where id = t.id;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'weeklyReports'->'updated', '[]'::jsonb))
  loop
    select * into w from public.task_weekly_reports
    where task_id = rec->>'taskId' and week_number = (rec->>'weekNumber')::int
    for update;
    if not found then raise exception 'missing' using errcode = 'P0001'; end if;
    sets := coalesce(rec->'sets', '{}'::jsonb);
    if sets ? 'progress' then
      if w.progress is distinct from coalesce((sets->'progress'->>'base')::int, 0) then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.progress := coalesce((sets->'progress'->>'value')::int, 0);
    end if;
    if sets ? 'weeklySummary' then
      if coalesce(w.weekly_summary, '') is distinct from coalesce(sets->'weeklySummary'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.weekly_summary := coalesce(sets->'weeklySummary'->>'value', '');
    end if;
    if sets ? 'weeklyDetail' then
      if coalesce(w.weekly_detail, '') is distinct from coalesce(sets->'weeklyDetail'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.weekly_detail := coalesce(sets->'weeklyDetail'->>'value', '');
    end if;
    if sets ? 'weeklyIssues' then
      if coalesce(w.weekly_issues, '') is distinct from coalesce(sets->'weeklyIssues'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.weekly_issues := coalesce(sets->'weeklyIssues'->>'value', '');
    end if;
    if sets ? 'nextWeekPlan' then
      if coalesce(w.next_week_plan, '') is distinct from coalesce(sets->'nextWeekPlan'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.next_week_plan := coalesce(sets->'nextWeekPlan'->>'value', '');
    end if;
    if sets ? 'instructorFeedback' then
      if coalesce(w.instructor_feedback, '') is distinct from coalesce(sets->'instructorFeedback'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.instructor_feedback := coalesce(sets->'instructorFeedback'->>'value', '');
    end if;
    if sets ? 'workStatus' then
      if coalesce(w.work_status, '') is distinct from coalesce(sets->'workStatus'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.work_status := coalesce(sets->'workStatus'->>'value', '');
    end if;
    if sets ? 'reportCompleted' then
      if w.report_completed is distinct from coalesce((sets->'reportCompleted'->>'base')::boolean, false) then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.report_completed := coalesce((sets->'reportCompleted'->>'value')::boolean, false);
    end if;
    update public.task_weekly_reports
    set progress = w.progress, weekly_summary = w.weekly_summary, weekly_detail = w.weekly_detail,
        weekly_issues = w.weekly_issues, next_week_plan = w.next_week_plan,
        instructor_feedback = w.instructor_feedback, work_status = w.work_status,
        report_completed = w.report_completed
    where id = w.id;
  end loop;
end;
$$;

revoke all on function public.item_key(jsonb, text) from public, anon, authenticated;
revoke all on function public.apply_keyed_ops(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.apply_dashboard_changes(jsonb) from public, anon, authenticated;
grant execute on function public.item_key(jsonb, text) to service_role;
grant execute on function public.apply_keyed_ops(jsonb, jsonb, text) to service_role;
grant execute on function public.apply_dashboard_changes(jsonb) to service_role;


-- 4) extras 변수명 수정

create or replace function public.apply_dashboard_changes(p_changes jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  rec jsonb;
  c public.companies%rowtype;
  p public.participants%rowtype;
  t public.tasks%rowtype;
  w public.task_weekly_reports%rowtype;
  sets jsonb;
  v_extras jsonb;
  bucket jsonb;
  spec jsonb;
  k text;
  task_text_keys text[] := array[
    'startDate', 'endDate', 'goal', 'asIsProcess', 'toBeProcess', 'difficulty', 'workStatus',
    'projectName', 'bdwSummary', 'bdwDetail', 'aiFit', 'asIsProcessDetail'
  ];
begin
  for rec in select value from jsonb_array_elements(coalesce(p_changes->'weeklyReports'->'deleted', '[]'::jsonb))
  loop
    delete from public.task_weekly_reports
    where task_id = rec->>'taskId' and week_number = (rec->>'weekNumber')::int;
  end loop;
  if jsonb_array_length(coalesce(p_changes->'tasks'->'deleted', '[]'::jsonb)) > 0 then
    delete from public.tasks
    where id in (select jsonb_array_elements_text(p_changes->'tasks'->'deleted'));
  end if;
  if jsonb_array_length(coalesce(p_changes->'participants'->'deleted', '[]'::jsonb)) > 0 then
    delete from public.participants
    where id in (select jsonb_array_elements_text(p_changes->'participants'->'deleted'));
  end if;
  if jsonb_array_length(coalesce(p_changes->'companies'->'deleted', '[]'::jsonb)) > 0 then
    delete from public.companies
    where id in (select jsonb_array_elements_text(p_changes->'companies'->'deleted'));
  end if;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'companies'->'created', '[]'::jsonb))
  loop
    insert into public.companies (id, name, start_date, kickoff_date, end_date, extras)
    values (
      rec->>'id',
      coalesce(rec->>'name', ''),
      nullif(rec->'schedule'->>'startDate', '')::date,
      nullif(rec->'schedule'->>'kickoffDate', '')::date,
      nullif(rec->'schedule'->>'endDate', '')::date,
      jsonb_build_object(
        'pmo', coalesce(rec->'pmo', '{"members":[]}'::jsonb),
        'notices', coalesce(rec->'notices', '[]'::jsonb),
        'participantUpdateRequest', coalesce(rec->'participantUpdateRequest', '{}'::jsonb)
      )
    )
    on conflict (id) do update set
      name = excluded.name,
      start_date = excluded.start_date,
      kickoff_date = excluded.kickoff_date,
      end_date = excluded.end_date,
      extras = excluded.extras;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'participants'->'created', '[]'::jsonb))
  loop
    insert into public.participants (
      id, company_id, name, email, dept, status, summary, next_week_plan, instructor_memo, registered_at
    ) values (
      rec->>'id',
      rec->>'companyId',
      coalesce(rec->>'name', ''),
      coalesce(rec->>'email', ''),
      coalesce(rec->>'dept', ''),
      coalesce(nullif(rec->>'status', ''), '정상'),
      coalesce(rec->>'summary', ''),
      coalesce(rec->>'nextWeekPlan', ''),
      coalesce(rec->>'instructorMemo', ''),
      nullif(rec->>'registeredAt', '')::timestamptz
    )
    on conflict (id) do update set
      company_id = excluded.company_id,
      name = excluded.name,
      email = excluded.email,
      dept = excluded.dept,
      status = excluded.status,
      summary = excluded.summary,
      next_week_plan = excluded.next_week_plan,
      instructor_memo = excluded.instructor_memo,
      registered_at = excluded.registered_at;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'tasks'->'created', '[]'::jsonb))
  loop
    insert into public.tasks (
      id, participant_id, name, progress, weekly_summary, weekly_detail, weekly_issues,
      next_week_plan, instructor_feedback, report_completed, extras
    ) values (
      rec->>'id',
      rec->>'participantId',
      coalesce(rec->>'name', ''),
      coalesce((rec->>'progress')::int, 0),
      coalesce(rec->>'weeklySummary', ''),
      coalesce(rec->>'weeklyDetail', ''),
      coalesce(rec->>'weeklyIssues', ''),
      coalesce(rec->>'nextWeekPlan', ''),
      coalesce(rec->>'instructorFeedback', ''),
      coalesce((rec->>'reportCompleted')::boolean, false),
      jsonb_build_object(
        'startDate', coalesce(rec->>'startDate', ''),
        'endDate', coalesce(rec->>'endDate', ''),
        'goal', coalesce(rec->>'goal', ''),
        'asIsProcess', coalesce(rec->>'asIsProcess', ''),
        'toBeProcess', coalesce(rec->>'toBeProcess', ''),
        'difficulty', coalesce(nullif(rec->>'difficulty', ''), '중'),
        'workStatus', coalesce(nullif(rec->>'workStatus', ''), '개발'),
        'hierarchy', coalesce(rec->'hierarchy', '{"l1":"","l2":"","l3":"","l4":""}'::jsonb),
        'statistics', coalesce(rec->'statistics', '{}'::jsonb),
        'members', coalesce(rec->'members', '[]'::jsonb),
        'projectName', coalesce(rec->>'projectName', ''),
        'bdwSummary', coalesce(rec->>'bdwSummary', ''),
        'bdwDetail', coalesce(rec->>'bdwDetail', ''),
        'aiFit', coalesce(rec->>'aiFit', ''),
        'asIsProcessDetail', coalesce(rec->>'asIsProcessDetail', '')
      )
    )
    on conflict (id) do update set
      participant_id = excluded.participant_id,
      name = excluded.name,
      progress = excluded.progress,
      weekly_summary = excluded.weekly_summary,
      weekly_detail = excluded.weekly_detail,
      weekly_issues = excluded.weekly_issues,
      next_week_plan = excluded.next_week_plan,
      instructor_feedback = excluded.instructor_feedback,
      report_completed = excluded.report_completed,
      extras = excluded.extras;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'weeklyReports'->'created', '[]'::jsonb))
  loop
    insert into public.task_weekly_reports (
      id, task_id, week_number, progress, weekly_summary, weekly_detail, weekly_issues,
      next_week_plan, instructor_feedback, work_status, report_completed, saved_at
    ) values (
      coalesce(nullif(rec->>'id', ''), 'twr-' || (rec->>'taskId') || '-w' || (rec->>'weekNumber')),
      rec->>'taskId',
      (rec->>'weekNumber')::int,
      coalesce((rec->>'progress')::int, 0),
      coalesce(rec->>'weeklySummary', ''),
      coalesce(rec->>'weeklyDetail', ''),
      coalesce(rec->>'weeklyIssues', ''),
      coalesce(rec->>'nextWeekPlan', ''),
      coalesce(rec->>'instructorFeedback', ''),
      coalesce(rec->>'workStatus', ''),
      coalesce((rec->>'reportCompleted')::boolean, false),
      coalesce(nullif(rec->>'savedAt', '')::timestamptz, now())
    )
    on conflict (task_id, week_number) do update set
      progress = excluded.progress,
      weekly_summary = excluded.weekly_summary,
      weekly_detail = excluded.weekly_detail,
      weekly_issues = excluded.weekly_issues,
      next_week_plan = excluded.next_week_plan,
      instructor_feedback = excluded.instructor_feedback,
      work_status = excluded.work_status,
      report_completed = excluded.report_completed,
      saved_at = excluded.saved_at;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'companies'->'updated', '[]'::jsonb))
  loop
    select * into c from public.companies where id = rec->>'id' for update;
    if not found then raise exception 'missing' using errcode = 'P0001'; end if;
    sets := coalesce(rec->'sets', '{}'::jsonb);
    v_extras := coalesce(c.extras, '{}'::jsonb);
    if sets ? 'name' then
      if coalesce(c.name, '') is distinct from coalesce(sets->'name'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      c.name := coalesce(sets->'name'->>'value', '');
    end if;
    if sets ? 'schedule' then
      if coalesce(c.start_date::text, '') is distinct from coalesce(sets->'schedule'->'base'->>'startDate', '')
        or coalesce(c.kickoff_date::text, '') is distinct from coalesce(sets->'schedule'->'base'->>'kickoffDate', '')
        or coalesce(c.end_date::text, '') is distinct from coalesce(sets->'schedule'->'base'->>'endDate', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      c.start_date := nullif(sets->'schedule'->'value'->>'startDate', '')::date;
      c.kickoff_date := nullif(sets->'schedule'->'value'->>'kickoffDate', '')::date;
      c.end_date := nullif(sets->'schedule'->'value'->>'endDate', '')::date;
    end if;
    if sets ? 'participantUpdateRequest' then
      if coalesce(v_extras->'participantUpdateRequest', 'null'::jsonb)
        is distinct from coalesce(sets->'participantUpdateRequest'->'base', 'null'::jsonb) then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      v_extras := jsonb_set(
        v_extras,
        '{participantUpdateRequest}',
        coalesce(sets->'participantUpdateRequest'->'value', '{}'::jsonb),
        true
      );
    end if;
    if rec ? 'noticeOps' then
      v_extras := jsonb_set(v_extras, '{notices}', public.apply_keyed_ops(v_extras->'notices', rec->'noticeOps', 'id'), true);
    end if;
    if rec ? 'pmoOps' then
      v_extras := jsonb_set(
        v_extras,
        '{pmo,members}',
        public.apply_keyed_ops(coalesce(v_extras->'pmo'->'members', '[]'::jsonb), rec->'pmoOps', 'email'),
        true
      );
    end if;
    update public.companies
    set name = c.name, start_date = c.start_date, kickoff_date = c.kickoff_date, end_date = c.end_date, extras = v_extras
    where id = c.id;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'participants'->'updated', '[]'::jsonb))
  loop
    select * into p from public.participants where id = rec->>'id' for update;
    if not found then raise exception 'missing' using errcode = 'P0001'; end if;
    sets := coalesce(rec->'sets', '{}'::jsonb);
    if sets ? 'companyId' then
      if p.company_id is distinct from coalesce(sets->'companyId'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.company_id := sets->'companyId'->>'value';
    end if;
    if sets ? 'name' then
      if coalesce(p.name, '') is distinct from coalesce(sets->'name'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.name := coalesce(sets->'name'->>'value', '');
    end if;
    if sets ? 'email' then
      if coalesce(p.email, '') is distinct from coalesce(sets->'email'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.email := coalesce(sets->'email'->>'value', '');
    end if;
    if sets ? 'dept' then
      if coalesce(p.dept, '') is distinct from coalesce(sets->'dept'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.dept := coalesce(sets->'dept'->>'value', '');
    end if;
    if sets ? 'status' then
      if coalesce(p.status, '') is distinct from coalesce(sets->'status'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.status := coalesce(sets->'status'->>'value', '정상');
    end if;
    if sets ? 'summary' then
      if coalesce(p.summary, '') is distinct from coalesce(sets->'summary'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.summary := coalesce(sets->'summary'->>'value', '');
    end if;
    if sets ? 'nextWeekPlan' then
      if coalesce(p.next_week_plan, '') is distinct from coalesce(sets->'nextWeekPlan'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.next_week_plan := coalesce(sets->'nextWeekPlan'->>'value', '');
    end if;
    if sets ? 'instructorMemo' then
      if coalesce(p.instructor_memo, '') is distinct from coalesce(sets->'instructorMemo'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      p.instructor_memo := coalesce(sets->'instructorMemo'->>'value', '');
    end if;
    update public.participants
    set company_id = p.company_id, name = p.name, email = p.email, dept = p.dept, status = p.status,
        summary = p.summary, next_week_plan = p.next_week_plan, instructor_memo = p.instructor_memo
    where id = p.id;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'tasks'->'updated', '[]'::jsonb))
  loop
    select * into t from public.tasks where id = rec->>'id' for update;
    if not found then raise exception 'missing' using errcode = 'P0001'; end if;
    sets := coalesce(rec->'sets', '{}'::jsonb);
    v_extras := coalesce(t.extras, '{}'::jsonb);
    if sets ? 'participantId' then
      if t.participant_id is distinct from coalesce(sets->'participantId'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.participant_id := sets->'participantId'->>'value';
    end if;
    if sets ? 'name' then
      if coalesce(t.name, '') is distinct from coalesce(sets->'name'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.name := coalesce(sets->'name'->>'value', '');
    end if;
    if sets ? 'progress' then
      if t.progress is distinct from coalesce((sets->'progress'->>'base')::int, 0) then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.progress := coalesce((sets->'progress'->>'value')::int, 0);
    end if;
    if sets ? 'weeklySummary' then
      if coalesce(t.weekly_summary, '') is distinct from coalesce(sets->'weeklySummary'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.weekly_summary := coalesce(sets->'weeklySummary'->>'value', '');
    end if;
    if sets ? 'weeklyDetail' then
      if coalesce(t.weekly_detail, '') is distinct from coalesce(sets->'weeklyDetail'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.weekly_detail := coalesce(sets->'weeklyDetail'->>'value', '');
    end if;
    if sets ? 'weeklyIssues' then
      if coalesce(t.weekly_issues, '') is distinct from coalesce(sets->'weeklyIssues'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.weekly_issues := coalesce(sets->'weeklyIssues'->>'value', '');
    end if;
    if sets ? 'nextWeekPlan' then
      if coalesce(t.next_week_plan, '') is distinct from coalesce(sets->'nextWeekPlan'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.next_week_plan := coalesce(sets->'nextWeekPlan'->>'value', '');
    end if;
    if sets ? 'instructorFeedback' then
      if coalesce(t.instructor_feedback, '') is distinct from coalesce(sets->'instructorFeedback'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.instructor_feedback := coalesce(sets->'instructorFeedback'->>'value', '');
    end if;
    if sets ? 'reportCompleted' then
      if t.report_completed is distinct from coalesce((sets->'reportCompleted'->>'base')::boolean, false) then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      t.report_completed := coalesce((sets->'reportCompleted'->>'value')::boolean, false);
    end if;
    foreach k in array task_text_keys loop
      if sets ? k then
        if coalesce(v_extras->>k, '') is distinct from coalesce(sets->k->>'base', '') then
          raise exception 'conflict' using errcode = 'P0001';
        end if;
        v_extras := jsonb_set(v_extras, array[k], to_jsonb(coalesce(sets->k->>'value', '')), true);
      end if;
    end loop;
    if rec ? 'hierOps' then
      bucket := coalesce(v_extras->'hierarchy', '{}'::jsonb);
      for k, spec in select key, value from jsonb_each(coalesce(rec->'hierOps'->'sets', '{}'::jsonb))
      loop
        if coalesce(bucket->k, 'null'::jsonb) is distinct from coalesce(spec->'base', 'null'::jsonb) then
          raise exception 'conflict' using errcode = 'P0001';
        end if;
        if spec->'value' is null or jsonb_typeof(spec->'value') = 'null' then
          bucket := bucket - k;
        else
          bucket := jsonb_set(bucket, array[k], spec->'value', true);
        end if;
      end loop;
      v_extras := jsonb_set(v_extras, '{hierarchy}', bucket, true);
    end if;
    if rec ? 'statOps' then
      bucket := coalesce(v_extras->'statistics', '{}'::jsonb);
      for k, spec in select key, value from jsonb_each(coalesce(rec->'statOps'->'sets', '{}'::jsonb))
      loop
        if coalesce(bucket->k, 'null'::jsonb) is distinct from coalesce(spec->'base', 'null'::jsonb) then
          raise exception 'conflict' using errcode = 'P0001';
        end if;
        if spec->'value' is null or jsonb_typeof(spec->'value') = 'null' then
          bucket := bucket - k;
        else
          bucket := jsonb_set(bucket, array[k], spec->'value', true);
        end if;
      end loop;
      v_extras := jsonb_set(v_extras, '{statistics}', bucket, true);
    end if;
    if rec ? 'memberOps' then
      v_extras := jsonb_set(v_extras, '{members}', public.apply_keyed_ops(v_extras->'members', rec->'memberOps', 'email'), true);
    end if;
    update public.tasks
    set participant_id = t.participant_id, name = t.name, progress = t.progress,
        weekly_summary = t.weekly_summary, weekly_detail = t.weekly_detail, weekly_issues = t.weekly_issues,
        next_week_plan = t.next_week_plan, instructor_feedback = t.instructor_feedback,
        report_completed = t.report_completed, extras = v_extras
    where id = t.id;
  end loop;

  for rec in select value from jsonb_array_elements(coalesce(p_changes->'weeklyReports'->'updated', '[]'::jsonb))
  loop
    select * into w from public.task_weekly_reports
    where task_id = rec->>'taskId' and week_number = (rec->>'weekNumber')::int
    for update;
    if not found then raise exception 'missing' using errcode = 'P0001'; end if;
    sets := coalesce(rec->'sets', '{}'::jsonb);
    if sets ? 'progress' then
      if w.progress is distinct from coalesce((sets->'progress'->>'base')::int, 0) then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.progress := coalesce((sets->'progress'->>'value')::int, 0);
    end if;
    if sets ? 'weeklySummary' then
      if coalesce(w.weekly_summary, '') is distinct from coalesce(sets->'weeklySummary'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.weekly_summary := coalesce(sets->'weeklySummary'->>'value', '');
    end if;
    if sets ? 'weeklyDetail' then
      if coalesce(w.weekly_detail, '') is distinct from coalesce(sets->'weeklyDetail'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.weekly_detail := coalesce(sets->'weeklyDetail'->>'value', '');
    end if;
    if sets ? 'weeklyIssues' then
      if coalesce(w.weekly_issues, '') is distinct from coalesce(sets->'weeklyIssues'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.weekly_issues := coalesce(sets->'weeklyIssues'->>'value', '');
    end if;
    if sets ? 'nextWeekPlan' then
      if coalesce(w.next_week_plan, '') is distinct from coalesce(sets->'nextWeekPlan'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.next_week_plan := coalesce(sets->'nextWeekPlan'->>'value', '');
    end if;
    if sets ? 'instructorFeedback' then
      if coalesce(w.instructor_feedback, '') is distinct from coalesce(sets->'instructorFeedback'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.instructor_feedback := coalesce(sets->'instructorFeedback'->>'value', '');
    end if;
    if sets ? 'workStatus' then
      if coalesce(w.work_status, '') is distinct from coalesce(sets->'workStatus'->>'base', '') then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.work_status := coalesce(sets->'workStatus'->>'value', '');
    end if;
    if sets ? 'reportCompleted' then
      if w.report_completed is distinct from coalesce((sets->'reportCompleted'->>'base')::boolean, false) then
        raise exception 'conflict' using errcode = 'P0001';
      end if;
      w.report_completed := coalesce((sets->'reportCompleted'->>'value')::boolean, false);
    end if;
    update public.task_weekly_reports
    set progress = w.progress, weekly_summary = w.weekly_summary, weekly_detail = w.weekly_detail,
        weekly_issues = w.weekly_issues, next_week_plan = w.next_week_plan,
        instructor_feedback = w.instructor_feedback, work_status = w.work_status,
        report_completed = w.report_completed
    where id = w.id;
  end loop;
end;
$$;

revoke all on function public.item_key(jsonb, text) from public, anon, authenticated;
revoke all on function public.apply_keyed_ops(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.apply_dashboard_changes(jsonb) from public, anon, authenticated;
grant execute on function public.item_key(jsonb, text) to service_role;
grant execute on function public.apply_keyed_ops(jsonb, jsonb, text) to service_role;
grant execute on function public.apply_dashboard_changes(jsonb) to service_role;
