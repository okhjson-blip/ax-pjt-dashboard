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

const DEFAULT_PARTICIPANT_UPDATE_REQUEST = {
  pending: false,
  message: "",
  requestedAt: null,
  acknowledgedAt: null
};

const TASK_EXTRAS_DEFAULTS = {
  startDate: "",
  endDate: "",
  goal: "",
  asIsProcess: "",
  toBeProcess: "",
  difficulty: "중",
  workStatus: "개발",
  hierarchy: { l1: "", l2: "", l3: "", l4: "" },
  statistics: {},
  members: [],
  projectName: "",
  bdwSummary: "",
  bdwDetail: "",
  aiFit: "",
  asIsProcessDetail: ""
};

const PARTICIPANT_COLUMNS = {
  companyId: ["company_id", (v) => v],
  name: ["name", (v) => String(v ?? "")],
  email: ["email", (v) => String(v ?? "")],
  dept: ["dept", (v) => v || ""],
  status: ["status", (v) => v || "정상"],
  summary: ["summary", (v) => v || ""],
  nextWeekPlan: ["next_week_plan", (v) => v || ""],
  instructorMemo: ["instructor_memo", (v) => v || ""],
  registeredAt: ["registered_at", (v) => v || null]
};

const TASK_COLUMNS = {
  participantId: ["participant_id", (v) => v],
  name: ["name", (v) => String(v ?? "")],
  progress: ["progress", (v) => Number(v || 0)],
  weeklySummary: ["weekly_summary", (v) => v || ""],
  weeklyDetail: ["weekly_detail", (v) => v || ""],
  weeklyIssues: ["weekly_issues", (v) => v || ""],
  nextWeekPlan: ["next_week_plan", (v) => v || ""],
  instructorFeedback: ["instructor_feedback", (v) => v || ""],
  reportCompleted: ["report_completed", (v) => Boolean(v)]
};

const WEEKLY_REPORT_COLUMNS = {
  progress: ["progress", (v) => Number(v || 0)],
  weeklySummary: ["weekly_summary", (v) => v || ""],
  weeklyDetail: ["weekly_detail", (v) => v || ""],
  weeklyIssues: ["weekly_issues", (v) => v || ""],
  nextWeekPlan: ["next_week_plan", (v) => v || ""],
  instructorFeedback: ["instructor_feedback", (v) => v || ""],
  workStatus: ["work_status", (v) => v || ""],
  reportCompleted: ["report_completed", (v) => Boolean(v)],
  savedAt: ["saved_at", (v) => v || new Date().toISOString()]
};

function pickColumns(source, columns) {
  const row = {};
  for (const [field, [column, convert]] of Object.entries(columns)) {
    if (Object.prototype.hasOwnProperty.call(source, field)) row[column] = convert(source[field]);
  }
  return row;
}

function companyExtrasPatch(source) {
  const extras = {};
  if ("pmo" in source) extras.pmo = normalizePmo(source.pmo);
  if ("notices" in source) extras.notices = Array.isArray(source.notices) ? source.notices : [];
  if ("participantUpdateRequest" in source) {
    extras.participantUpdateRequest = source.participantUpdateRequest || DEFAULT_PARTICIPANT_UPDATE_REQUEST;
  }
  return extras;
}

function companyColumnsPatch(source) {
  const row = {};
  if ("name" in source) row.name = String(source.name ?? "");
  if ("schedule" in source) {
    row.start_date = source.schedule?.startDate || null;
    row.kickoff_date = source.schedule?.kickoffDate || null;
    row.end_date = source.schedule?.endDate || null;
  }
  return row;
}

function taskExtrasPatch(source) {
  const extras = {};
  for (const [key, fallback] of Object.entries(TASK_EXTRAS_DEFAULTS)) {
    if (!(key in source)) continue;
    const value = source[key];
    if (Array.isArray(fallback)) extras[key] = Array.isArray(value) ? value : fallback;
    else if (typeof fallback === "object") extras[key] = value && typeof value === "object" ? value : fallback;
    else extras[key] = value || fallback;
  }
  return extras;
}

function companyRow(company) {
  return {
    id: company.id,
    ...companyColumnsPatch({ name: company.name, schedule: company.schedule || {} }),
    extras: companyExtrasPatch({
      pmo: company.pmo,
      notices: company.notices,
      participantUpdateRequest: company.participantUpdateRequest
    })
  };
}

function participantRow(participant) {
  const full = {};
  for (const field of Object.keys(PARTICIPANT_COLUMNS)) full[field] = participant[field];
  return { id: participant.id, ...pickColumns(full, PARTICIPANT_COLUMNS) };
}

function taskRow(task) {
  const full = {};
  for (const field of Object.keys(TASK_COLUMNS)) full[field] = task[field];
  const extrasSource = {};
  for (const key of Object.keys(TASK_EXTRAS_DEFAULTS)) extrasSource[key] = task[key];
  return { id: task.id, ...pickColumns(full, TASK_COLUMNS), extras: taskExtrasPatch(extrasSource) };
}

function weeklyReportRow(report) {
  const weekNumber = Number(report.weekNumber);
  const full = {};
  for (const field of Object.keys(WEEKLY_REPORT_COLUMNS)) full[field] = report[field];
  return {
    id: report.id || weeklyReportId(report.taskId, weekNumber),
    task_id: report.taskId,
    week_number: weekNumber,
    ...pickColumns(full, WEEKLY_REPORT_COLUMNS)
  };
}

function toConflictError(error) {
  if (error?.code === "23505") {
    return new StoreConflictError("이미 등록된 이메일입니다. 기존 정보로 로그인해 주세요.");
  }
  if (error?.code === "23503") {
    return new StoreConflictError(
      "다른 사용자가 상위 항목(협력사·참여자·과제)을 삭제했습니다. 새로고침 후 다시 시도해 주세요."
    );
  }
  return error;
}

function check({ error }) {
  if (error) throw toConflictError(error);
}

async function updateRowsWithExtras(sb, table, updates, buildColumns, buildExtras) {
  const extrasIds = updates.filter((u) => Object.keys(buildExtras(u)).length).map((u) => u.id);
  const currentExtras = new Map();
  if (extrasIds.length) {
    const { data, error } = await sb.from(table).select("id, extras").in("id", extrasIds);
    if (error) throw error;
    for (const row of data || []) currentExtras.set(row.id, row.extras || {});
  }
  for (const update of updates) {
    const patch = buildColumns(update);
    const extrasPatch = buildExtras(update);
    if (Object.keys(extrasPatch).length) {
      if (!currentExtras.has(update.id)) continue;
      patch.extras = { ...currentExtras.get(update.id), ...extrasPatch };
    }
    if (!Object.keys(patch).length) continue;
    check(await sb.from(table).update(patch).eq("id", update.id));
  }
}

// 클라이언트가 보낸 변경분(생성·수정 필드·명시적 삭제)만 반영한다. 다른 사용자의 행은 건드리지 않는다.
async function applyChanges(rawChanges) {
  const changes = normalizeChanges(rawChanges);
  if (!countChanges(changes)) return;
  return withSupabaseRetry(async () => {
    const sb = getSupabaseAdmin();
    const { companies, participants, tasks, weeklyReports } = changes;

    for (const row of weeklyReports.deleted) {
      check(
        await sb
          .from("task_weekly_reports")
          .delete()
          .eq("task_id", row.taskId)
          .eq("week_number", Number(row.weekNumber))
      );
    }
    if (tasks.deleted.length) check(await sb.from("tasks").delete().in("id", tasks.deleted));
    if (participants.deleted.length) check(await sb.from("participants").delete().in("id", participants.deleted));
    if (companies.deleted.length) check(await sb.from("companies").delete().in("id", companies.deleted));

    if (companies.created.length) {
      check(await sb.from("companies").upsert(companies.created.map(companyRow), { onConflict: "id" }));
    }
    if (participants.created.length) {
      check(await sb.from("participants").upsert(participants.created.map(participantRow), { onConflict: "id" }));
    }
    if (tasks.created.length) {
      check(await sb.from("tasks").upsert(tasks.created.map(taskRow), { onConflict: "id" }));
    }
    if (weeklyReports.created.length) {
      check(
        await sb
          .from("task_weekly_reports")
          .upsert(weeklyReports.created.map(weeklyReportRow), { onConflict: "task_id,week_number" })
      );
    }

    await updateRowsWithExtras(sb, "companies", companies.updated, companyColumnsPatch, companyExtrasPatch);
    for (const update of participants.updated) {
      const patch = pickColumns(update, PARTICIPANT_COLUMNS);
      if (Object.keys(patch).length) check(await sb.from("participants").update(patch).eq("id", update.id));
    }
    await updateRowsWithExtras(sb, "tasks", tasks.updated, (u) => pickColumns(u, TASK_COLUMNS), taskExtrasPatch);
    for (const update of weeklyReports.updated) {
      const patch = pickColumns(update, WEEKLY_REPORT_COLUMNS);
      if (!Object.keys(patch).length) continue;
      check(
        await sb
          .from("task_weekly_reports")
          .update(patch)
          .eq("task_id", update.taskId)
          .eq("week_number", Number(update.weekNumber))
      );
    }
  });
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
  uid,
  weeklyReportId
};
