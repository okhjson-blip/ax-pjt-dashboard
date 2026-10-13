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
