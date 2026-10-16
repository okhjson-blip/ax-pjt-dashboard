const { getSupabaseAdmin } = require("./supabase");
const { createSeedData } = require("./seed-data");
const { uid } = require("./store-utils");
const { normalizePmo } = require("./pmo");
const { StoreConflictError, normalizeChanges, countChanges, weeklyReportId } = require("./store-changes");

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

const PAGE_SIZE = 1000;

// PostgREST는 요청당 최대 행 수(기본 1000)를 넘으면 잘라서 반환하므로 끝까지 페이지를 읽는다.
async function selectAll(sb, table, orderColumns) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = sb.from(table).select("*");
    for (const column of orderColumns) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function readData() {
  return withSupabaseRetry(async () => {
    const sb = getSupabaseAdmin();

    const [companies, participants, tasks, weeklyRows, { data: metaRows, error: mErr }] = await Promise.all([
      selectAll(sb, "companies", ["created_at", "id"]),
      selectAll(sb, "participants", ["created_at", "id"]),
      selectAll(sb, "tasks", ["created_at", "id"]),
      selectAll(sb, "task_weekly_reports", ["week_number", "id"]),
      sb.from("app_meta").select("*").eq("key", "dashboard").maybeSingle()
    ]);
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

function mapChangeError(error) {
  const msg = String(error?.message || '');
  if (error?.code === '42501') return new (require('./access').AccessError)();
  if (error?.code === "23505" || /23505|duplicate key/i.test(msg)) {
    return new StoreConflictError("이미 존재하는 항목 또는 이메일입니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.");
  }
  if (error?.code === "23503" || /23503|foreign key/i.test(msg) || /missing/i.test(msg)) {
    return new StoreConflictError("다른 사용자가 이 항목을 삭제했습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.");
  }
  if (error?.code === "P0001" || /conflict/i.test(msg)) {
    return new StoreConflictError("다른 사용자가 같은 내용을 먼저 수정했습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.");
  }
  return error;
}

async function applyChanges(rawChanges, actor = null) {
  const changes = normalizeChanges(rawChanges);
  if (!countChanges(changes)) return;
  return withSupabaseRetry(async () => {
    const sb = getSupabaseAdmin();
    const { error } = actor
      ? await sb.rpc('apply_authorized_dashboard_changes', {p_changes:changes,p_actor:actor})
      : await sb.rpc('apply_dashboard_changes', {p_changes:changes});
    if (error) throw mapChangeError(error);
  });
}

function check({ error }) {
  if (error) throw mapChangeError(error);
}

async function updateMeta(patch) {
  return withSupabaseRetry(async () => {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from("app_meta").select("value").eq("key", "dashboard").maybeSingle();
    if (error) throw error;
    const value = { ...(data?.value || {}), ...patch };
    check(
      await sb
        .from("app_meta")
        .upsert({ key: "dashboard", value, updated_at: new Date().toISOString() }, { onConflict: "key" })
    );
    return value;
  });
}

// 전체 데이터 교체. 시드 초기화(reset-data) 전용이며 API 요청에서는 사용하지 않는다.
async function writeData(data) {
  return withSupabaseRetry(async () => {
    const sb = getSupabaseAdmin();
    const companies = data.companies || [];

    const existingCompanies = await selectAll(sb, "companies", ["id"]);
    if (existingCompanies.length) {
      check(await sb.from("companies").delete().in("id", existingCompanies.map((r) => r.id)));
    }

    const changes = {
      companies: { created: companies },
      participants: { created: [] },
      tasks: { created: [] },
      weeklyReports: { created: [] }
    };
    for (const company of companies) {
      for (const participant of company.participants || []) {
        changes.participants.created.push({ ...participant, companyId: company.id });
        for (const task of participant.tasks || []) {
          changes.tasks.created.push({ ...task, participantId: participant.id });
          for (const report of task.weeklyReports || []) {
            changes.weeklyReports.created.push({
              ...report,
              taskId: task.id,
              workStatus: report.workStatus || task.workStatus || ""
            });
          }
        }
      }
    }
    await applyChanges(changes);
    const meta = await updateMeta({ ...(data.meta || {}), lastSavedAt: new Date().toISOString() });
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

async function backfillCompanyWeeklyReportSource(doc, saved) {
  return withSupabaseRetry(async () => {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from("company_weekly_reports")
      .update({ source: doc.source })
      .eq("id", doc.id)
      .eq("status", "published")
      .eq("updated_at", saved.updatedAt)
      .eq("source", JSON.stringify(saved.source || {}))
      .select("*")
      .maybeSingle();
    if (error) throw error;
    // A concurrent writer won: return its document rather than overwrite it.
    return data ? mapCompanyWeeklyReportRow(data) : getCompanyWeeklyReport(doc.companyId, doc.weekNumber);
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
  applyChanges,
  updateMeta,
  resetData,
  getCompanyWeeklyReport,
  upsertCompanyWeeklyReport,
  backfillCompanyWeeklyReportSource,
  uid,
  weeklyReportId
};
