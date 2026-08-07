const { getSupabaseAdmin } = require("./supabase");
const { createSeedData } = require("./seed-data");
const { uid } = require("./store-utils");

function mapCompanyRow(row, participants = []) {
  const extras = row.extras && typeof row.extras === "object" ? row.extras : {};
  return {
    id: row.id,
    name: row.name,
    schedule: {
      startDate: row.start_date || "",
      kickoffDate: row.kickoff_date || "",
      endDate: row.end_date || ""
    },
    pmo: extras.pmo || { name: row.pmo_name || "", email: row.pmo_email || "" },
    notices: extras.notices || [],
    participantUpdateRequest: extras.participantUpdateRequest || {
      pending: false,
      message: "",
      requestedAt: null,
      acknowledgedAt: null
    },
    participants
  };
}

function mapParticipantRow(row, tasks = []) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    dept: row.dept || "",
    status: row.status || "정상",
    summary: row.summary || "",
    nextWeekPlan: row.next_week_plan || "",
    instructorMemo: row.instructor_memo || "",
    registeredAt: row.registered_at || null,
    tasks
  };
}

function mapTaskRow(row) {
  const extras = row.extras && typeof row.extras === "object" ? row.extras : {};
  return {
    id: row.id,
    name: row.name,
    progress: Number(row.progress || 0),
    weeklySummary: row.weekly_summary || "",
    nextWeekPlan: row.next_week_plan || "",
    instructorFeedback: row.instructor_feedback || "",
    reportCompleted: Boolean(row.report_completed),
    startDate: extras.startDate || row.start_date || "",
    endDate: extras.endDate || row.end_date || "",
    goal: extras.goal || row.goal || "",
    asIsProcess: extras.asIsProcess || row.as_is_process || "",
    toBeProcess: extras.toBeProcess || row.to_be_process || "",
    difficulty: extras.difficulty || "중"
  };
}

async function readData() {
  const sb = getSupabaseAdmin();

  const [{ data: companies, error: cErr }, { data: participants, error: pErr }, { data: tasks, error: tErr }, { data: metaRows, error: mErr }] =
    await Promise.all([
      sb.from("companies").select("*").order("created_at", { ascending: true }),
      sb.from("participants").select("*").order("created_at", { ascending: true }),
      sb.from("tasks").select("*").order("created_at", { ascending: true }),
      sb.from("app_meta").select("*").eq("key", "dashboard").maybeSingle()
    ]);

  if (cErr) throw cErr;
  if (pErr) throw pErr;
  if (tErr) throw tErr;
  if (mErr) throw mErr;

  const tasksByParticipant = new Map();
  for (const task of tasks || []) {
    const list = tasksByParticipant.get(task.participant_id) || [];
    list.push(mapTaskRow(task));
    tasksByParticipant.set(task.participant_id, list);
  }

  const participantsByCompany = new Map();
  for (const participant of participants || []) {
    const list = participantsByCompany.get(participant.company_id) || [];
    list.push(mapParticipantRow(participant, tasksByParticipant.get(participant.id) || []));
    participantsByCompany.set(participant.company_id, list);
  }

  const metaValue = metaRows?.value || {};
  return {
    companies: (companies || []).map((row) => mapCompanyRow(row, participantsByCompany.get(row.id) || [])),
    meta: {
      lastSavedAt: metaValue.lastSavedAt || null,
      lastReportRequestAt: metaValue.lastReportRequestAt || null,
      lastParticipantSyncAt: metaValue.lastParticipantSyncAt || null
    }
  };
}

async function writeData(data) {
  const sb = getSupabaseAdmin();
  const companies = data.companies || [];
  const nowIso = new Date().toISOString();

  const companyIds = companies.map((c) => c.id);
  const participantRows = [];
  const taskRows = [];

  for (const company of companies) {
    for (const participant of company.participants || []) {
      participantRows.push({
        id: participant.id,
        company_id: company.id,
        name: participant.name,
        email: participant.email,
        dept: participant.dept || "",
        status: participant.status || "정상",
        summary: participant.summary || "",
        next_week_plan: participant.nextWeekPlan || "",
        instructor_memo: participant.instructorMemo || "",
        registered_at: participant.registeredAt || null
      });
      for (const task of participant.tasks || []) {
        taskRows.push({
          id: task.id,
          participant_id: participant.id,
          name: task.name,
          progress: Number(task.progress || 0),
          weekly_summary: task.weeklySummary || "",
          next_week_plan: task.nextWeekPlan || "",
          instructor_feedback: task.instructorFeedback || "",
          report_completed: Boolean(task.reportCompleted),
          extras: {
            startDate: task.startDate || "",
            endDate: task.endDate || "",
            goal: task.goal || "",
            asIsProcess: task.asIsProcess || "",
            toBeProcess: task.toBeProcess || "",
            difficulty: task.difficulty || "중"
          }
        });
      }
    }
  }

  const companyRows = companies.map((company) => ({
    id: company.id,
    name: company.name,
    start_date: company.schedule?.startDate || null,
    kickoff_date: company.schedule?.kickoffDate || null,
    end_date: company.schedule?.endDate || null,
    extras: {
      pmo: company.pmo || { name: "", email: "" },
      notices: company.notices || [],
      participantUpdateRequest: company.participantUpdateRequest || {
        pending: false,
        message: "",
        requestedAt: null,
        acknowledgedAt: null
      }
    }
  }));

  const participantIds = participantRows.map((p) => p.id);
  const taskIds = taskRows.map((t) => t.id);

  // 삭제된 레코드 정리 (전체 문서 덮어쓰기 모델)
  const { data: existingCompanies, error: ecErr } = await sb.from("companies").select("id");
  if (ecErr) throw ecErr;
  const deleteCompanyIds = (existingCompanies || []).map((r) => r.id).filter((id) => !companyIds.includes(id));
  if (deleteCompanyIds.length) {
    const { error } = await sb.from("companies").delete().in("id", deleteCompanyIds);
    if (error) throw error;
  }

  const { data: existingParticipants, error: epErr } = await sb.from("participants").select("id");
  if (epErr) throw epErr;
  const deleteParticipantIds = (existingParticipants || [])
    .map((r) => r.id)
    .filter((id) => !participantIds.includes(id));
  if (deleteParticipantIds.length) {
    const { error } = await sb.from("participants").delete().in("id", deleteParticipantIds);
    if (error) throw error;
  }

  const { data: existingTasks, error: etErr } = await sb.from("tasks").select("id");
  if (etErr) throw etErr;
  const deleteTaskIds = (existingTasks || []).map((r) => r.id).filter((id) => !taskIds.includes(id));
  if (deleteTaskIds.length) {
    const { error } = await sb.from("tasks").delete().in("id", deleteTaskIds);
    if (error) throw error;
  }

  if (companyRows.length) {
    const { error } = await sb.from("companies").upsert(companyRows, { onConflict: "id" });
    if (error) throw error;
  }
  if (participantRows.length) {
    const { error } = await sb.from("participants").upsert(participantRows, { onConflict: "id" });
    if (error) throw error;
  }
  if (taskRows.length) {
    const { error } = await sb.from("tasks").upsert(taskRows, { onConflict: "id" });
    if (error) throw error;
  }

  const meta = {
    ...(data.meta || {}),
    lastSavedAt: nowIso
  };

  const { error: metaErr } = await sb.from("app_meta").upsert(
    { key: "dashboard", value: meta, updated_at: nowIso },
    { onConflict: "key" }
  );
  if (metaErr) throw metaErr;

  return { companies, meta };
}

async function resetData() {
  const seed = createSeedData();
  return writeData(seed);
}

module.exports = {
  readData,
  writeData,
  resetData,
  uid
};
