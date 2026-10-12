const { getSupabaseAdmin } = require("./supabase");
const { createSeedData } = require("./seed-data");
const { uid } = require("./store-utils");
const { normalizePmo } = require("./pmo");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientJwtError(err) {
  const msg = String(err?.message || err || "");
  return /JWT issued at future/i.test(msg);
}

async function withSupabaseRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientJwtError(err) || i === attempts - 1) throw err;
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

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
    pmo: normalizePmo(extras.pmo || { name: row.pmo_name || "", email: row.pmo_email || "" }),
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

function mapWeeklyReportRow(row) {
  return {
    id: row.id,
    weekNumber: Number(row.week_number || 1),
    progress: Number(row.progress || 0),
    weeklySummary: row.weekly_summary || "",
    weeklyDetail: row.weekly_detail || "",
    weeklyIssues: row.weekly_issues || "",
    nextWeekPlan: row.next_week_plan || "",
    instructorFeedback: row.instructor_feedback || "",
    workStatus: row.work_status || "",
    reportCompleted: Boolean(row.report_completed),
    savedAt: row.saved_at || null
  };
}

function mapTaskRow(row, weeklyReports = []) {
  const extras = row.extras && typeof row.extras === "object" ? row.extras : {};
  return {
    id: row.id,
    name: row.name,
    progress: Number(row.progress || 0),
    weeklySummary: row.weekly_summary || "",
    weeklyDetail: row.weekly_detail || "",
    weeklyIssues: row.weekly_issues || "",
    nextWeekPlan: row.next_week_plan || "",
    instructorFeedback: row.instructor_feedback || "",
    reportCompleted: Boolean(row.report_completed),
    workStatus: extras.workStatus || "개발",
    startDate: extras.startDate || row.start_date || "",
    endDate: extras.endDate || row.end_date || "",
    goal: extras.goal || row.goal || "",
    asIsProcess: extras.asIsProcess || row.as_is_process || "",
    toBeProcess: extras.toBeProcess || row.to_be_process || "",
    difficulty: extras.difficulty || "중",
    hierarchy: extras.hierarchy || { l1: "", l2: "", l3: "", l4: "" },
    statistics: extras.statistics || {},
    members: Array.isArray(extras.members) ? extras.members : [],
    projectName: extras.projectName || "",
    bdwSummary: extras.bdwSummary || "",
    bdwDetail: extras.bdwDetail || "",
    aiFit: extras.aiFit || "",
    asIsProcessDetail: extras.asIsProcessDetail || "",
    weeklyReports
  };
}

function weeklyReportId(taskId, weekNumber) {
  return `twr-${taskId}-w${weekNumber}`;
}

async function readData() {
  return withSupabaseRetry(async () => {
    const sb = getSupabaseAdmin();

    const [
      { data: companies, error: cErr },
      { data: participants, error: pErr },
      { data: tasks, error: tErr },
      { data: weeklyRows, error: wErr },
      { data: metaRows, error: mErr }
    ] = await Promise.all([
      sb.from("companies").select("*").order("created_at", { ascending: true }),
      sb.from("participants").select("*").order("created_at", { ascending: true }),
      sb.from("tasks").select("*").order("created_at", { ascending: true }),
      sb.from("task_weekly_reports").select("*").order("week_number", { ascending: true }),
      sb.from("app_meta").select("*").eq("key", "dashboard").maybeSingle()
    ]);

    if (cErr) throw cErr;
    if (pErr) throw pErr;
    if (tErr) throw tErr;
    if (wErr) throw wErr;
    if (mErr) throw mErr;

    const reportsByTask = new Map();
    for (const row of weeklyRows || []) {
      const list = reportsByTask.get(row.task_id) || [];
      list.push(mapWeeklyReportRow(row));
      reportsByTask.set(row.task_id, list);
    }

    const tasksByParticipant = new Map();
    for (const task of tasks || []) {
      const list = tasksByParticipant.get(task.participant_id) || [];
      list.push(mapTaskRow(task, reportsByTask.get(task.id) || []));
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
  });
}

async function writeData(data) {
  return withSupabaseRetry(async () => {
    const sb = getSupabaseAdmin();
    const companies = data.companies || [];
    const nowIso = new Date().toISOString();

    const companyIds = companies.map((c) => c.id);
    const participantRows = [];
    const taskRows = [];
    const weeklyReportRows = [];

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
            weekly_detail: task.weeklyDetail || "",
            weekly_issues: task.weeklyIssues || "",
            next_week_plan: task.nextWeekPlan || "",
            instructor_feedback: task.instructorFeedback || "",
            report_completed: Boolean(task.reportCompleted),
            extras: {
              startDate: task.startDate || "",
              endDate: task.endDate || "",
              goal: task.goal || "",
              asIsProcess: task.asIsProcess || "",
              toBeProcess: task.toBeProcess || "",
              difficulty: task.difficulty || "중",
              workStatus: task.workStatus || "개발",
              hierarchy: task.hierarchy || { l1: "", l2: "", l3: "", l4: "" },
              statistics: task.statistics || {},
              members: Array.isArray(task.members) ? task.members : [],
              projectName: task.projectName || "",
              bdwSummary: task.bdwSummary || "",
              bdwDetail: task.bdwDetail || "",
              aiFit: task.aiFit || "",
              asIsProcessDetail: task.asIsProcessDetail || ""
            }
          });
          for (const report of task.weeklyReports || []) {
            const weekNumber = Number(report.weekNumber || 0);
            if (!weekNumber || weekNumber < 1) continue;
            weeklyReportRows.push({
              id: report.id || weeklyReportId(task.id, weekNumber),
              task_id: task.id,
              week_number: weekNumber,
              progress: Number(report.progress || 0),
              weekly_summary: report.weeklySummary || "",
              weekly_detail: report.weeklyDetail || "",
              weekly_issues: report.weeklyIssues || "",
              next_week_plan: report.nextWeekPlan || "",
              instructor_feedback: report.instructorFeedback || "",
              work_status: report.workStatus || task.workStatus || "",
              report_completed: Boolean(report.reportCompleted),
              saved_at: report.savedAt || nowIso,
              updated_at: nowIso
            });
          }
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
        pmo: normalizePmo(company.pmo),
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
    const weeklyReportIds = weeklyReportRows.map((r) => r.id);

    const [
      { data: existingCompanies, error: ecErr },
      { data: existingParticipants, error: epErr },
      { data: existingTasks, error: etErr },
      { data: existingReports, error: erErr }
    ] = await Promise.all([
      sb.from("companies").select("id"),
      sb.from("participants").select("id"),
      sb.from("tasks").select("id"),
      sb.from("task_weekly_reports").select("id")
    ]);
    if (ecErr) throw ecErr;
    if (epErr) throw epErr;
    if (etErr) throw etErr;
    if (erErr) throw erErr;

    const deleteCompanyIds = (existingCompanies || []).map((r) => r.id).filter((id) => !companyIds.includes(id));
    if (deleteCompanyIds.length) {
      const { error } = await sb.from("companies").delete().in("id", deleteCompanyIds);
      if (error) throw error;
    }

    const deleteParticipantIds = (existingParticipants || [])
      .map((r) => r.id)
      .filter((id) => !participantIds.includes(id));
    if (deleteParticipantIds.length) {
      const { error } = await sb.from("participants").delete().in("id", deleteParticipantIds);
      if (error) throw error;
    }

    const deleteTaskIds = (existingTasks || []).map((r) => r.id).filter((id) => !taskIds.includes(id));
    if (deleteTaskIds.length) {
      const { error } = await sb.from("tasks").delete().in("id", deleteTaskIds);
      if (error) throw error;
    }

    const deleteReportIds = (existingReports || []).map((r) => r.id).filter((id) => !weeklyReportIds.includes(id));
    if (deleteReportIds.length) {
      const { error } = await sb.from("task_weekly_reports").delete().in("id", deleteReportIds);
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
    if (weeklyReportRows.length) {
      const { error } = await sb.from("task_weekly_reports").upsert(weeklyReportRows, {
        onConflict: "task_id,week_number"
      });
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
  });
}

function mapCompanyWeeklyReportRow(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    weekNumber: Number(row.week_number || 1),
    status: row.status === "published" ? "published" : "draft",
    title: row.title || "",
    subtitle: row.subtitle || "",
    periodStart: row.period_start || "",
    periodEnd: row.period_end || "",
    location: row.location || "",
    body: row.body && typeof row.body === "object" ? row.body : {},
    source: row.source && typeof row.source === "object" ? row.source : {},
    publishedAt: row.published_at || null,
    updatedAt: row.updated_at || null
  };
}

async function getCompanyWeeklyReport(companyId, weekNumber) {
  return withSupabaseRetry(async () => {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("company_weekly_reports")
      .select("*")
      .eq("company_id", companyId)
      .eq("week_number", Number(weekNumber))
      .maybeSingle();
    if (error) throw error;
    return data ? mapCompanyWeeklyReportRow(data) : null;
  });
}

async function upsertCompanyWeeklyReport(doc) {
  return withSupabaseRetry(async () => {
    const sb = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const row = {
      id: doc.id,
      company_id: doc.companyId,
      week_number: Number(doc.weekNumber),
      status: doc.status === "published" ? "published" : "draft",
      title: doc.title || "",
      subtitle: doc.subtitle || "",
      period_start: doc.periodStart || null,
      period_end: doc.periodEnd || null,
      location: doc.location || "",
      body: doc.body || {},
      source: doc.source || {},
      published_at: doc.publishedAt || null,
      updated_at: nowIso
    };
    const { data, error } = await sb
      .from("company_weekly_reports")
      .upsert(row, { onConflict: "company_id,week_number" })
      .select("*")
      .single();
    if (error) throw error;
    return mapCompanyWeeklyReportRow(data);
  });
}

async function resetData() {
  const seed = createSeedData();
  return writeData(seed);
}

module.exports = {
  readData,
  writeData,
  resetData,
  getCompanyWeeklyReport,
  upsertCompanyWeeklyReport,
  uid,
  weeklyReportId
};
