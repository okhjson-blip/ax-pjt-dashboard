const { uid } = require("./store-utils");

const WORK_STATUSES = ["설계", "개발", "구축", "가동", "운영", "보류"];
const SECTION_HEADINGS = ["구성", "진행", "이슈", "리뷰 방향", "차주"];
const OPS_PRIORITY = {
  stalled: { priority: 1, label: "일정 정체" },
  overdue: { priority: 2, label: "기한 초과" },
  "no-tasks": { priority: 3, label: "과제 미등록" },
  "missing-report": { priority: 4, label: "보고 미작성" },
  watch: { priority: 5, label: "일정 주의" }
};

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

function difficultyWeight(value) {
  const raw = String(value || "중").trim();
  if (raw === "상") return 3;
  if (raw === "하") return 1;
  return 2;
}

function avgProgress(participant) {
  const tasks = participant?.tasks || [];
  if (!tasks.length) return 0;
  let weightSum = 0;
  let progressSum = 0;
  tasks.forEach((task) => {
    const w = difficultyWeight(task.difficulty);
    weightSum += w;
    progressSum += Number(task.progress || 0) * w;
  });
  return weightSum ? Math.round(progressSum / weightSum) : 0;
}

function expectedProgressAvg(participant, company) {
  const tasks = participant?.tasks || [];
  if (!tasks.length) return null;
  let weightSum = 0;
  let expectedSum = 0;
  let hasValue = false;
  tasks.forEach((task) => {
    const own = elapsedRateFromDates(task.startDate, task.endDate);
    const expected = own !== null ? own : elapsedRateFromDates(company?.schedule?.startDate, company?.schedule?.endDate);
    if (expected === null) return;
    hasValue = true;
    const w = difficultyWeight(task.difficulty);
    weightSum += w;
    expectedSum += expected * w;
  });
  if (!hasValue || !weightSum) return null;
  return Math.round(expectedSum / weightSum);
}

function scheduleReason(company, participant) {
  if (!participant?.tasks?.length) return { reason: "no-tasks", diff: 0, label: "과제없음" };
  const actual = avgProgress(participant);
  const expected = expectedProgressAvg(participant, company);
  if (expected === null) return { reason: "no-schedule", diff: 0, label: "일정미설정" };
  const diff = actual - expected;
  if (diff >= 0) return { reason: "ok", diff, label: "양호" };
  if (diff >= -15) return { reason: "watch", diff, label: "정상" };
  return { reason: "stalled", diff, label: "정체" };
}

function isTaskOverdue(task, now = new Date()) {
  if (!task?.endDate || Number(task.progress || 0) >= 100) return false;
  const end = new Date(`${task.endDate}T23:59:59+09:00`);
  return !Number.isNaN(end.getTime()) && now > end;
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

function taskOwnerLabel(task, participant) {
  const owner = (task.members || []).find((m) => m.isOwner && m.name);
  if (owner?.name) {
    const role = owner.role || owner.position || "";
    return role ? `${owner.name} (${role})` : owner.name;
  }
  if (participant?.dept && participant?.name) return `${participant.dept} / ${participant.name}`;
  return participant?.name || participant?.dept || "";
}

function compositionText(task) {
  const parts = [];
  if (task.goal) parts.push(String(task.goal).trim());
  const h = task.hierarchy || {};
  const levels = [h.l1, h.l2, h.l3, h.l4].map((v) => String(v || "").trim()).filter(Boolean);
  if (levels.length) parts.push(levels.join(" > "));
  if (task.asIsProcess) parts.push(`As-Is: ${String(task.asIsProcess).trim()}`);
  if (task.toBeProcess) parts.push(`To-Be: ${String(task.toBeProcess).trim()}`);
  return parts.join("\n");
}

function splitPlanLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-•●○☐☑]\s*/, "").trim())
    .filter(Boolean);
}

function collectOpsIssues(company, weekNumber, currentWeek) {
  const rows = [];
  (company?.participants || []).forEach((participant) => {
    const schedule = scheduleReason(company, participant);
    const tasks = participant.tasks || [];
    let code = null;
    if (schedule.reason === "stalled") code = "stalled";
    else if (tasks.some((task) => isTaskOverdue(task))) code = "overdue";
    else if (schedule.reason === "no-tasks") code = "no-tasks";
    else if (
      tasks.some((task) => {
        const view = reportForWeek(task, weekNumber, currentWeek);
        return !view || !view.reportCompleted;
      })
    ) {
      code = "missing-report";
    } else if (schedule.reason === "watch" && schedule.diff <= -10) code = "watch";

    if (!code) return;
    const meta = OPS_PRIORITY[code];
    rows.push({
      item: meta.label,
      content: `${participant.name}${participant.dept ? ` (${participant.dept})` : ""} · ${schedule.label}`,
      status: "미해소",
      code
    });
  });
  return rows.sort((a, b) => (OPS_PRIORITY[a.code]?.priority || 9) - (OPS_PRIORITY[b.code]?.priority || 9));
}

function emptyBody() {
  return {
    summaryRows: [],
    sections: [],
    issues: [],
    checks: [],
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
  const summaryRows = [];
  const sections = [];
  const checks = [];
  const sourceTasks = [];

  (company?.participants || []).forEach((participant) => {
    (participant.tasks || []).forEach((task) => {
      const view = reportForWeek(task, week, currentWeek);
      const owner = taskOwnerLabel(task, participant);
      const status = normalizeWorkStatus(view?.workStatus || task.workStatus);
      const progressNote = (view?.weeklySummary || "").trim();
      const detail = (view?.weeklyDetail || "").trim() || progressNote;
      const issues = (view?.weeklyIssues || "").trim();
      const plan = (view?.nextWeekPlan || "").trim();
      const review = (view?.instructorFeedback || "").trim();

      summaryRows.push({
        taskId: task.id,
        deliverable: task.name || "과제 없음",
        owner,
        status,
        progressNote
      });

      sections.push({
        taskId: task.id,
        title: task.name || "과제 없음",
        owner,
        blocks: [
          { heading: "구성", text: compositionText(task) },
          { heading: "진행", text: detail },
          { heading: "이슈", text: issues },
          { heading: "리뷰 방향", text: review },
          { heading: "차주", text: plan }
        ]
      });

      splitPlanLines(plan).forEach((text) => {
        checks.push({ text, done: false, taskId: task.id });
      });

      sourceTasks.push({
        taskId: task.id,
        participantId: participant.id,
        name: task.name,
        weekNumber: week,
        reportCompleted: Boolean(view?.reportCompleted),
        weeklySummary: progressNote,
        weeklyDetail: view?.weeklyDetail || "",
        weeklyIssues: issues,
        nextWeekPlan: plan
      });
    });
  });

  const issues = collectOpsIssues(company, week, currentWeek);
  issues.forEach((issue) => {
    if (issue.code === "missing-report") {
      checks.push({ text: `${issue.content} 주간보고 작성 여부 확인`, done: false });
    }
  });

  doc.body = {
    summaryRows,
    sections,
    issues: issues.map(({ item, content, status }) => ({ item, content, status })),
    checks,
    footerNote: `본 보고는 ${formatPeriodLabel(doc.periodStart, doc.periodEnd)}${
      doc.location ? ` ${doc.location}` : ""
    } 기준입니다. 현장 확인으로 수치·계획이 변할 수 있습니다.`
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
  merged.source = assembled.source || merged.source || {};
  merged.status = merged.status === "published" ? "draft" : merged.status || "draft";
  return merged;
}

function normalizeBody(body) {
  const src = body && typeof body === "object" ? body : {};
  return {
    summaryRows: Array.isArray(src.summaryRows)
      ? src.summaryRows.map((row) => ({
          taskId: row.taskId || "",
          deliverable: row.deliverable || "",
          owner: row.owner || "",
          status: row.status || "",
          progressNote: row.progressNote || ""
        }))
      : [],
    sections: Array.isArray(src.sections)
      ? src.sections.map((section) => ({
          taskId: section.taskId || "",
          title: section.title || "",
          owner: section.owner || "",
          blocks: Array.isArray(section.blocks)
            ? section.blocks.map((block) => ({
                heading: block.heading || "",
                text: block.text || ""
              }))
            : SECTION_HEADINGS.map((heading) => ({ heading, text: "" }))
        }))
      : [],
    issues: Array.isArray(src.issues)
      ? src.issues.map((row) => ({
          item: row.item || "",
          content: row.content || "",
          status: row.status || ""
        }))
      : [],
    checks: Array.isArray(src.checks)
      ? src.checks.map((row) => ({
          text: row.text || "",
          done: Boolean(row.done),
          taskId: row.taskId || ""
        }))
      : [],
    footerNote: src.footerNote || ""
  };
}

function normalizeReportDoc(input, company) {
  const week = Math.max(1, Number(input?.weekNumber) || 1);
  const fallback = emptyReportDoc(company, week);
  return {
    id: input?.id || fallback.id,
    companyId: input?.companyId || company?.id || fallback.companyId,
    weekNumber: week,
    status: input?.status === "published" ? "published" : "draft",
    title: input?.title || fallback.title,
    subtitle: input?.subtitle || "",
    periodStart: input?.periodStart || fallback.periodStart,
    periodEnd: input?.periodEnd || fallback.periodEnd,
    location: input?.location || "",
    body: normalizeBody(input?.body),
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
  SECTION_HEADINGS,
  getConsultingWeek,
  consultingWeekRange,
  formatPeriodLabel,
  normalizeWorkStatus,
  companyWeeklyReportId,
  emptyBody,
  emptyReportDoc,
  assembleCompanyWeeklyReport,
  mergeAssembledDraft,
  normalizeReportDoc,
  normalizeBody,
  newRowId
};
