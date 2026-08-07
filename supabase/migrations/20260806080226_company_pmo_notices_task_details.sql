-- 업체 PMO/공지/업데이트요청, 과제 상세 확장 필드

alter table public.companies
  add column if not exists extras jsonb not null default '{}'::jsonb;

alter table public.tasks
  add column if not exists extras jsonb not null default '{}'::jsonb;

comment on column public.companies.extras is 'pmo, notices, participantUpdateRequest JSON';
comment on column public.tasks.extras is 'startDate, endDate, goal, asIsProcess, toBeProcess, difficulty JSON';
