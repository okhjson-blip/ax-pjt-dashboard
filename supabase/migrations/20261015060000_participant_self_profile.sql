-- The service client is trusted, but app ownership is rechecked inside the write transaction.
-- Short serialized writes also protect against concurrent admin reassignment/revocation.
create or replace function public.apply_authorized_dashboard_changes(p_changes jsonb, p_actor jsonb)
returns void language plpgsql set search_path = public as $$
declare
  v_role text := p_actor->>'role';
  v_company text := p_actor->>'companyId';
  v_participant text := p_actor->>'participantId';
  rec jsonb;
  v_owner text;
  v_parent text;
  v_pmo jsonb;
  v_personal boolean;
begin
  lock table public.companies, public.participants, public.tasks, public.task_weekly_reports in share row exclusive mode;
  if v_role = 'admin' then perform public.apply_dashboard_changes(p_changes); return; end if;
  if v_role is null or v_role not in ('pmo','participant') then raise exception 'permission denied' using errcode='42501'; end if;
  if v_role = 'participant' then
    if not exists(select 1 from public.participants where id=v_participant and company_id=v_company and lower(btrim(email))=lower(btrim(p_actor->>'email'))) then raise exception 'permission denied' using errcode='42501'; end if;
  else
    select extras->'pmo' into v_pmo from public.companies where id=v_company;
    if not exists(select 1 from jsonb_array_elements(coalesce(v_pmo->'members','[]'::jsonb)) m where btrim(m->>'name')=btrim(p_actor->>'name') and lower(btrim(m->>'email'))=lower(btrim(p_actor->>'email'))) then
      raise exception 'permission denied' using errcode='42501';
    end if;
  end if;
  v_personal := exists(select 1 from public.participants where id=v_participant and company_id=v_company and lower(btrim(email))=lower(btrim(p_actor->>'email')));
  if jsonb_array_length(coalesce(p_changes->'companies'->'created','[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_changes->'companies'->'deleted','[]'::jsonb)) > 0 then raise exception 'permission denied' using errcode='42501'; end if;
  for rec in select value from jsonb_array_elements(coalesce(p_changes->'companies'->'updated','[]'::jsonb)) loop
    if v_role <> 'pmo' or rec->>'id' is distinct from v_company or rec ? 'pmoOps' or rec ? 'memberOps' or rec ? 'statOps' or rec ? 'hierOps' or exists(select 1 from jsonb_object_keys(coalesce(rec->'sets','{}'::jsonb)) k where k <> 'participantUpdateRequest') then raise exception 'permission denied' using errcode='42501'; end if;
  end loop;
  for rec in select value from jsonb_array_elements(coalesce(p_changes->'participants'->'created','[]'::jsonb)) loop
    if v_role <> 'pmo' or rec->>'companyId' is distinct from v_company then raise exception 'permission denied' using errcode='42501'; end if;
  end loop;
  for rec in select value from jsonb_array_elements(coalesce(p_changes->'participants'->'updated','[]'::jsonb)) loop
    select company_id into v_parent from public.participants where id=rec->>'id';
    if v_role = 'participant' then
      if not v_personal or rec->>'id' is distinct from v_participant or v_parent is distinct from v_company or exists(select 1 from jsonb_object_keys(coalesce(rec->'sets','{}'::jsonb)) k where k not in ('name','email','dept')) then raise exception 'permission denied' using errcode='42501'; end if;
    elsif v_parent is distinct from v_company or (rec->'sets' ? 'companyId' and rec->'sets'->'companyId'->>'value' is distinct from v_company) then raise exception 'permission denied' using errcode='42501'; end if;
  end loop;
  for rec in select value from jsonb_array_elements(coalesce(p_changes->'participants'->'deleted','[]'::jsonb)) loop
    select company_id into v_parent from public.participants where id=rec #>> '{}';
    if v_role <> 'pmo' or v_parent is distinct from v_company then raise exception 'permission denied' using errcode='42501'; end if;
  end loop;
  for rec in select value from jsonb_array_elements(coalesce(p_changes->'tasks'->'created','[]'::jsonb)) loop
    if not v_personal or v_participant is null or rec->>'participantId' is distinct from v_participant or not exists(select 1 from public.participants where id=v_participant and company_id=v_company) then raise exception 'permission denied' using errcode='42501'; end if;
  end loop;
  for rec in select value from jsonb_array_elements(coalesce(p_changes->'tasks'->'updated','[]'::jsonb)) loop
    select participant_id into v_owner from public.tasks where id=rec->>'id';
    if not v_personal or v_participant is null or v_owner is distinct from v_participant or rec->'sets' ? 'participantId' then raise exception 'permission denied' using errcode='42501'; end if;
  end loop;
  for rec in select value from jsonb_array_elements(coalesce(p_changes->'tasks'->'deleted','[]'::jsonb)) loop
    select participant_id into v_owner from public.tasks where id=rec #>> '{}';
    if not v_personal or v_participant is null or v_owner is distinct from v_participant then raise exception 'permission denied' using errcode='42501'; end if;
  end loop;
  for rec in select value from jsonb_array_elements(coalesce(p_changes->'weeklyReports'->'created','[]'::jsonb) || coalesce(p_changes->'weeklyReports'->'updated','[]'::jsonb) || coalesce(p_changes->'weeklyReports'->'deleted','[]'::jsonb)) loop
    select participant_id into v_owner from public.tasks where id=rec->>'taskId';
    if v_owner is null then
      select value->>'participantId' into v_owner from jsonb_array_elements(coalesce(p_changes->'tasks'->'created','[]'::jsonb)) where value->>'id'=rec->>'taskId' limit 1;
    end if;
    if not v_personal or v_participant is null or v_owner is distinct from v_participant then raise exception 'permission denied' using errcode='42501'; end if;
  end loop;
  perform public.apply_dashboard_changes(p_changes);
end;
$$;
revoke all on function public.apply_authorized_dashboard_changes(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.apply_authorized_dashboard_changes(jsonb,jsonb) to service_role;
