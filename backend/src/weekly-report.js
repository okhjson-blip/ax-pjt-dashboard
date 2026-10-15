const { uid } = require("./store-utils");
const { composeWeekSummary, composeNextPlan } = require("./report-draft");

const WORK_STATUSES = ["설계", "개발", "구축", "가동", "운영", "보류"];

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeWorkStatus(value) {
  const raw = String(value || "").trim();
  return WORK_STATUSES.includes(raw) ? raw : "개발";
}

function isoDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getConsultingWeek(startDate, now = new Date()) {
  if (!startDate) {
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const diff = now - yearStart;
    const oneWeek = 1000 * 60 * 60 * 24 * 7;
    return Math.max(1, Math.ceil((diff + yearStart.getDay() * 86400000) / oneWeek));
  }
  const start = new Date(`${startDate}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime())) return 1;
  if (now < start) return 1;
  return Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function consultingWeekRange(startDate, weekNumber) {
  const week = Math.max(1, Number(weekNumber) || 1);
  const start = startDate ? new Date(`${startDate}T00:00:00+09:00`) : new Date();
  if (Number.isNaN(start.getTime())) {
    const today = new Date();
    return { periodStart: isoDate(today), periodEnd: isoDate(today) };
  }
  const periodStart = new Date(start);
  periodStart.setDate(periodStart.getDate() + (week - 1) * 7);
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + 6);
  return { periodStart: isoDate(periodStart), periodEnd: isoDate(periodEnd) };
}

function formatPeriodLabel(periodStart, periodEnd) {
  if (!periodStart && !periodEnd) return "";
  if (periodStart && periodEnd) return `${periodStart} ~ ${periodEnd}`;
  return periodStart || periodEnd || "";
}

function elapsedRateFromDates(startDate, endDate, now = new Date()) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00+09:00`);
  const end = new Date(`${endDate}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  if (now < start) return 0;
  const total = end - start;
  const elapsed = Math.min(Math.max(now - start, 0), total);
  return Math.round((elapsed / total) * 100);
}

function metricReferenceDate(company, weekNumber, now) {
  const range = consultingWeekRange(company?.schedule?.startDate, weekNumber);
  const end = new Date(`${range.periodEnd}T12:00:00+09:00`);
  if (Number.isNaN(end.getTime())) return now;
  return now.getTime() < end.getTime() ? now : end;
}

function taskExpectedAt(task, company, now) {
  const own = elapsedRateFromDates(task.startDate, task.endDate, now);
  if (own !== null) return own;
  return elapsedRateFromDates(company?.schedule?.startDate, company?.schedule?.endDate, now);
}

function participantProgressAt(participant, weekNumber, currentWeek) {
  const tasks=participant?.tasks || [];
  if (!tasks.length) return 0;
  return Math.round(tasks.reduce((sum,t) => sum + Number(reportForWeek(t,weekNumber,currentWeek)?.progress || 0),0) / tasks.length);
}

function scheduleAchievementAt(participant, company, weekNumber, currentWeek, now) {
  const tasks = participant?.tasks || [];
  if (!tasks.length) return null;
  let ratioSum = 0;
  let measurable = 0;
  let beforeStart = 0;
  tasks.forEach((task) => {
    const expected = taskExpectedAt(task, company, now);
    if (expected === null) return;
    if (expected === 0) {
      beforeStart += 1;
      return;
    }
    const view = reportForWeek(task, weekNumber, currentWeek);
    const progress = view ? Number(view.progress || 0) : 0;
    ratioSum += Math.min(1, Math.max(0, Number.isFinite(progress) ? progress / expected : 0));
    measurable += 1;
  });
  if (measurable) return Math.round((ratioSum / measurable) * 100);
  if (beforeStart && beforeStart === tasks.length) return 100;
  return null;
}

function companyOpsSummary(company, weekNumber, now = new Date()) {
  const week = Math.max(1, Number(weekNumber) || 1);
  const currentWeek = getConsultingWeek(company?.schedule?.startDate, now);
  const ref = metricReferenceDate(company, week, now);
  const participants = company?.participants || [];
  const taskCount = participants.reduce((sum, participant) => sum + (participant.tasks || []).length, 0);
  const participantCount = participants.length;
  const allTasks={tasks:participants.flatMap(p => p.tasks || [])};
  const progress=participantProgressAt(allTasks,week,currentWeek);
  const scheduleGoalRate=scheduleAchievementAt(allTasks,company,week,currentWeek,ref);
  return {
    taskCount,
    participantCount,
    progress,
    scheduleGoalRate
  };
}

function reportForWeek(task, weekNumber, currentWeek) {
  const week = Number(weekNumber);
  if (Number(currentWeek) === week) {
    return {
      progress: Number(task.progress || 0),
      weeklySummary: task.weeklySummary || "",
      weeklyDetail: task.weeklyDetail || "",
      weeklyIssues: task.weeklyIssues || "",
      nextWeekPlan: task.nextWeekPlan || "",
      instructorFeedback: task.instructorFeedback || "",
      workStatus: normalizeWorkStatus(task.workStatus),
      reportCompleted: Boolean(task.reportCompleted)
    };
  }
  const snap = (task.weeklyReports || []).find((row) => Number(row.weekNumber) === week);
  if (!snap) return null;
  return {
    progress: Number(snap.progress || 0),
    weeklySummary: snap.weeklySummary || "",
    weeklyDetail: snap.weeklyDetail || "",
    weeklyIssues: snap.weeklyIssues || "",
    nextWeekPlan: snap.nextWeekPlan || "",
    instructorFeedback: snap.instructorFeedback || "",
    workStatus: normalizeWorkStatus(snap.workStatus || task.workStatus),
    reportCompleted: Boolean(snap.reportCompleted)
  };
}

function taskAssignee(task, participant) {
  const members = Array.isArray(task?.members) ? task.members : [];
  const owner =
    members.find((member) => member && member.isOwner && String(member.name || "").trim()) ||
    members.find((member) => member && String(member.name || "").trim());
  return {
    ownerName: String(owner?.name || participant?.name || "").trim(),
    dept: String(participant?.dept || "").trim()
  };
}

function clampProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function emptyOps() {
  return {
    taskCount: 0,
    participantCount: 0,
    progress: 0,
    scheduleGoalRate: null
  };
}

function emptyBody() {
  return {
    ops: emptyOps(),
    weekSummary: "",
    nextWeekPlan: "",
    narrativeSource: "",
    taskRows: [],
    footerNote: ""
  };
}

function emptyReportDoc(company, weekNumber) {
  const week = Math.max(1, Number(weekNumber) || 1);
  const range = consultingWeekRange(company?.schedule?.startDate, week);
  return {
    id: companyWeeklyReportId(company?.id, week),
    companyId: company?.id || "",
    weekNumber: week,
    status: "draft",
    title: `${company?.name || "협력사"} 주간보고 (${week}주차)`,
    subtitle: "",
    periodStart: range.periodStart,
    periodEnd: range.periodEnd,
    location: "",
    body: emptyBody(),
    source: {},
    publishedAt: null
  };
}

function companyWeeklyReportId(companyId, weekNumber) {
  return `cwr-${companyId || "co"}-w${Number(weekNumber) || 1}`;
}

function assembleCompanyWeeklyReport(company, weekNumber, now = new Date()) {
  const week = Math.max(1, Number(weekNumber) || 1);
  const currentWeek = getConsultingWeek(company?.schedule?.startDate, now);
  const doc = emptyReportDoc(company, week);
  const taskRows = [];
  const sourceTasks = [];

  (company?.participants || []).forEach((participant) => {
    (participant.tasks || []).forEach((task) => {
      const view = reportForWeek(task, week, currentWeek);
      const assignee = taskAssignee(task, participant);
      const weeklyProgress = String(view?.weeklySummary || "").trim();
      const nextPlan = String(view?.nextWeekPlan || "").trim();
      const progress = view ? clampProgress(view.progress) : 0;
      taskRows.push({
        taskId: task.id || "",
        name: task.name || "과제 없음",
        ownerName: assignee.ownerName,
        dept: assignee.dept,
        periodStart: task.startDate || "",
        periodEnd: task.endDate || "",
        progress,
        weeklyProgress,
        nextPlan
      });
      sourceTasks.push({
        taskId: task.id,
        participantId: participant.id,
        name: task.name,
        ownerName: assignee.ownerName,
        dept: assignee.dept,
        weekNumber: week,
        reportCompleted: Boolean(view?.reportCompleted),
        progress,
        weeklySummary: weeklyProgress,
        nextWeekPlan: nextPlan
      });
    });
  });

  doc.body = {
    ops: companyOpsSummary(company, week, now),
    weekSummary: composeWeekSummary(company?.name, taskRows),
    nextWeekPlan: composeNextPlan(company?.name, taskRows),
    narrativeSource: "compiled",
    taskRows,
    footerNote: ""
  };
  doc.source = {
    assembledAt: now.toISOString(),
    weekNumber: week,
    currentWeek,
    taskCount: sourceTasks.length,
    tasks: sourceTasks
  };
  return doc;
}

function isBlank(value) {
  if (value == null) return true;
  if (typeof value === "string") return !String(value).trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function rowKey(row) {
  if (!row || typeof row !== "object") return "";
  if (row.taskId && row.nextPlan !== undefined && row.deliverable === undefined && !Array.isArray(row.blocks)) {
    return `task:${row.taskId}`;
  }
  if (row.heading) return `heading:${row.heading}`;
  if (row.taskId && Array.isArray(row.blocks)) return `section:${row.taskId}`;
  if (row.taskId && row.deliverable !== undefined) return `summary:${row.taskId}`;
  if (row.item) return `item:${row.item}`;
  if (row.text) return `text:${row.text}`;
  if (row.id) return `id:${row.id}`;
  return "";
}

function mergeRows(target, source) {
  const t = Array.isArray(target) ? target.map((row) => clone(row)) : [];
  const s = Array.isArray(source) ? source : [];
  if (!t.length) return clone(s);

  const keyed = new Map();
  const rest = [];
  t.forEach((row, index) => {
    const key = rowKey(row);
    if (key && !keyed.has(key)) keyed.set(key, { row, index });
    else rest.push({ row, index });
  });

  s.forEach((row) => {
    const key = rowKey(row);
    if (key && keyed.has(key)) {
      keyed.get(key).row = mergeEmpty(keyed.get(key).row, row);
      return;
    }
    const fingerprint = JSON.stringify({
      text: row.text || "",
      item: row.item || "",
      content: row.content || "",
      heading: row.heading || ""
    });
    const exists = [...keyed.values(), ...rest].some(
      ({ row: existing }) =>
        JSON.stringify({
          text: existing.text || "",
          item: existing.item || "",
          content: existing.content || "",
          heading: existing.heading || ""
        }) === fingerprint
    );
    if (!exists) rest.push({ row: clone(row), index: t.length + rest.length });
  });

  return [...keyed.values(), ...rest]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.row);
}

function mergeEmpty(target, source) {
  if (source == null) return target;
  if (isBlank(target)) return clone(source);
  if (Array.isArray(target) || Array.isArray(source)) return mergeRows(target, source);
  if (typeof target === "object" && typeof source === "object") {
    const out = { ...target };
    Object.keys(source).forEach((key) => {
      out[key] = mergeEmpty(out[key], source[key]);
    });
    return out;
  }
  return target;
}

function mergeAssembledDraft(existing, assembled) {
  if (!existing) return clone(assembled);
  const merged = clone(existing);
  merged.title = isBlank(merged.title) ? assembled.title : merged.title;
  merged.subtitle = isBlank(merged.subtitle) ? assembled.subtitle : merged.subtitle;
  merged.periodStart = isBlank(merged.periodStart) ? assembled.periodStart : merged.periodStart;
  merged.periodEnd = isBlank(merged.periodEnd) ? assembled.periodEnd : merged.periodEnd;
  merged.location = isBlank(merged.location) ? assembled.location : merged.location;
  merged.body = mergeEmpty(merged.body || emptyBody(), assembled.body || emptyBody());
  merged.body.ops = clone(assembled.body?.ops || emptyOps());
  merged.source = assembled.source || merged.source || {};
  merged.status = merged.status === "published" ? "draft" : merged.status || "draft";
  return merged;
}

function normalizeOps(ops) {
  if (!ops || typeof ops !== "object" || Array.isArray(ops)) return null;
  const taskCount = Number(ops.taskCount);
  const participantCount = Number(ops.participantCount);
  const progress = Number(ops.progress);
  if (![taskCount, participantCount, progress].every((value) => Number.isFinite(value))) return null;
  const rate =
    ops.scheduleGoalRate == null || ops.scheduleGoalRate === "" ? null : Number(ops.scheduleGoalRate);
  return {
    taskCount: Math.max(0, Math.round(taskCount)),
    participantCount: Math.max(0, Math.round(participantCount)),
    progress: clampProgress(progress),
    scheduleGoalRate: Number.isFinite(rate) ? clampProgress(rate) : null
  };
}

function splitLegacyOwner(owner) {
  const raw = String(owner || "").trim();
  const parts = raw.split(/\s*\/\s*/);
  if (parts.length === 2) {
    return {
      dept: parts[0].trim(),
      ownerName: parts[1].replace(/\s*\([^)]*\)\s*$/, "").trim()
    };
  }
  return { dept: "", ownerName: raw.replace(/\s*\([^)]*\)\s*$/, "").trim() };
}

function blockText(section, heading) {
  const block = (section?.blocks || []).find((item) => item?.heading === heading);
  return String(block?.text || "").trim();
}

function normalizeTaskRow(row) {
  return {
    taskId: row?.taskId || "",
    name: row?.name || "",
    ownerName: row?.ownerName || "",
    dept: row?.dept || "",
    periodStart: row?.periodStart || "",
    periodEnd: row?.periodEnd || "",
    progress: clampProgress(row?.progress),
    weeklyProgress: row?.weeklyProgress || "",
    nextPlan: row?.nextPlan || ""
  };
}

function migrateTaskRows(src) {
  if (Array.isArray(src.taskRows) && src.taskRows.length) {
    return src.taskRows.map((row) => normalizeTaskRow(row));
  }
  const map = new Map();
  (Array.isArray(src.summaryRows) ? src.summaryRows : []).forEach((row) => {
    const owner = splitLegacyOwner(row.owner);
    const key = row.taskId || row.deliverable || "";
    map.set(key, {
      taskId: row.taskId || "",
      name: row.deliverable || "",
      ownerName: owner.ownerName,
      dept: owner.dept,
      periodStart: "",
      periodEnd: "",
      progress: 0,
      weeklyProgress: row.progressNote || "",
      nextPlan: ""
    });
  });
  (Array.isArray(src.sections) ? src.sections : []).forEach((section) => {
    const owner = splitLegacyOwner(section.owner);
    const key = section.taskId || section.title || "";
    const prev = map.get(key) || {
      taskId: section.taskId || "",
      name: section.title || "",
      ownerName: owner.ownerName,
      dept: owner.dept,
      periodStart: "",
      periodEnd: "",
      progress: 0,
      weeklyProgress: "",
      nextPlan: ""
    };
    if (!prev.name) prev.name = section.title || "";
    if (!prev.ownerName) prev.ownerName = owner.ownerName;
    if (!prev.dept) prev.dept = owner.dept;
    if (!prev.weeklyProgress) prev.weeklyProgress = blockText(section, "진행");
    if (!prev.nextPlan) prev.nextPlan = blockText(section, "차주");
    map.set(key, prev);
  });
  return [...map.values()].map((row) => normalizeTaskRow(row));
}

function normalizeNarrativeSource(value) {
  return value === "ai" || value === "compiled" || value === "edited" ? value : "";
}

function normalizeBody(body) {
  const src = body && typeof body === "object" ? body : {};
  return {
    ops: normalizeOps(src.ops) || emptyOps(),
    weekSummary: src.weekSummary || "",
    nextWeekPlan: src.nextWeekPlan || "",
    narrativeSource: normalizeNarrativeSource(src.narrativeSource),
    taskRows: migrateTaskRows(src),
    footerNote: src.footerNote || ""
  };
}

function normalizeReportDoc(input, company) {
  const week = Math.max(1, Number(input?.weekNumber) || 1);
  const fallback = emptyReportDoc(company, week);
  const body = normalizeBody(input?.body);
  const published = input?.status === "published";
  if (!normalizeOps(input?.body?.ops) && company) {
    body.ops = companyOpsSummary(company, week);
  }
  if (published) {
    if (!String(body.weekSummary || "").trim()) {
      body.weekSummary = composeWeekSummary(company?.name, body.taskRows);
    }
    if (!String(body.nextWeekPlan || "").trim()) {
      body.nextWeekPlan = composeNextPlan(company?.name, body.taskRows);
    }
  }
  return {
    id: input?.id || fallback.id,
    companyId: input?.companyId || company?.id || fallback.companyId,
    weekNumber: week,
    status: published ? "published" : "draft",
    title: input?.title || fallback.title,
    subtitle: "",
    periodStart: input?.periodStart || fallback.periodStart,
    periodEnd: input?.periodEnd || fallback.periodEnd,
    location: input?.location || "",
    body,
    source: input?.source && typeof input.source === "object" ? input.source : {},
    publishedAt: input?.publishedAt || null,
    updatedAt: input?.updatedAt || null
  };
}

function newRowId(prefix) {
  return uid(prefix);
}

module.exports = {
  WORK_STATUSES,
  getConsultingWeek,
  consultingWeekRange,
  formatPeriodLabel,
  normalizeWorkStatus,
  companyWeeklyReportId,
  companyOpsSummary,
  emptyBody,
  emptyReportDoc,
  assembleCompanyWeeklyReport,
  mergeAssembledDraft,
  normalizeReportDoc,
  normalizeBody,
  newRowId
};
