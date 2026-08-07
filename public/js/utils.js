function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8);
}

const DIFFICULTY_WEIGHT = { 상: 3, 중: 2, 하: 1 };

function normalizeDifficulty(value) {
  const raw = String(value || "중").trim().toLowerCase();
  if (raw === "상" || raw === "high" || raw === "h") return "상";
  if (raw === "하" || raw === "low" || raw === "l") return "하";
  if (raw === "중" || raw === "mid" || raw === "medium" || raw === "m") return "중";
  return "중";
}

function difficultyWeight(value) {
  return DIFFICULTY_WEIGHT[normalizeDifficulty(value)] || 2;
}

/** 시작~종료일 경과율(0~100). 유효하지 않으면 null */
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

function companyElapsedRate(company) {
  return elapsedRateFromDates(company?.schedule?.startDate, company?.schedule?.endDate);
}

/** 과제 기대 진척: 과제 일정 우선, 없으면 협력사 일정 */
function taskExpectedProgress(task, company) {
  const t = ensureTaskFields(task);
  const own = elapsedRateFromDates(t.startDate, t.endDate);
  if (own !== null) return own;
  return companyElapsedRate(company);
}

/** 전체 진척도: 난이도(상3/중2/하1) 가중 평균 */
function avgProgress(participant) {
  const tasks = participant?.tasks || [];
  if (!tasks.length) return 0;
  let weightSum = 0;
  let progressSum = 0;
  tasks.forEach((task) => {
    const t = ensureTaskFields(task);
    const w = difficultyWeight(t.difficulty);
    weightSum += w;
    progressSum += Number(t.progress || 0) * w;
  });
  return weightSum ? Math.round(progressSum / weightSum) : 0;
}

/** 기대 진척 평균(난이도 가중). 계산 불가 시 null */
function expectedProgressAvg(participant, company) {
  const tasks = participant?.tasks || [];
  if (!tasks.length) return null;
  let weightSum = 0;
  let expectedSum = 0;
  let hasValue = false;
  tasks.forEach((task) => {
    const expected = taskExpectedProgress(task, company);
    if (expected === null) return;
    hasValue = true;
    const w = difficultyWeight(ensureTaskFields(task).difficulty);
    weightSum += w;
    expectedSum += expected * w;
  });
  if (!hasValue || !weightSum) return null;
  return Math.round(expectedSum / weightSum);
}

/**
 * 일정 달성율: 과제별 (progress ÷ 기대) 난이도 가중 평균 × 100.
 * 기대=0(시작 전) 과제는 제외. 전부 시작 전이면 100.
 */
function scheduleAchievementRate(participant, company) {
  const tasks = participant?.tasks || [];
  if (!tasks.length) return null;
  let weightSum = 0;
  let ratioSum = 0;
  let measurable = 0;
  let beforeStart = 0;

  tasks.forEach((task) => {
    const expected = taskExpectedProgress(task, company);
    if (expected === null) return;
    if (expected === 0) {
      beforeStart += 1;
      return;
    }
    const progress = Number(ensureTaskFields(task).progress || 0);
    const w = difficultyWeight(ensureTaskFields(task).difficulty);
    weightSum += w;
    ratioSum += (progress / expected) * w;
    measurable += 1;
  });

  if (measurable && weightSum) return Math.round((ratioSum / weightSum) * 100);
  if (beforeStart && beforeStart === tasks.length) return 100;
  return null;
}

/**
 * 일정 상태: 전체 진척도 − 기대 진척 평균
 * ≥0 양호 / ≥−15 정상 / <−15 정체
 */
function scheduleStatus(company, participant) {
  if (!participant?.tasks?.length) {
    return {
      label: "과제없음",
      cls: "gray",
      diff: 0,
      target: 0,
      actual: 0,
      achievement: null,
      reason: "no-tasks"
    };
  }
  const actual = avgProgress(participant);
  const expected = expectedProgressAvg(participant, company);
  const achievement = scheduleAchievementRate(participant, company);
  if (expected === null) {
    return {
      label: "일정미설정",
      cls: "gray",
      diff: 0,
      target: 0,
      actual,
      achievement: null,
      reason: "no-schedule"
    };
  }
  const diff = actual - expected;
  const base = { diff, target: expected, actual, achievement };
  if (diff >= 0) return { label: "양호", cls: "green", reason: "ok", ...base };
  if (diff >= -15) return { label: "정상", cls: "blue", reason: "watch", ...base };
  return { label: "정체", cls: "red", reason: "stalled", ...base };
}

function isTaskOverdue(task, now = new Date()) {
  const t = ensureTaskFields(task);
  if (!t.endDate || Number(t.progress || 0) >= 100) return false;
  const end = new Date(`${t.endDate}T23:59:59+09:00`);
  return !Number.isNaN(end.getTime()) && now > end;
}

const OPS_PRIORITY = {
  stalled: { priority: 1, label: "일정 정체" },
  overdue: { priority: 2, label: "기한 초과" },
  "no-tasks": { priority: 3, label: "과제 미등록" },
  "missing-report": { priority: 4, label: "보고 미작성" },
  watch: { priority: 5, label: "일정 주의" }
};

/**
 * 운영 체크: 참여자당 최상위 이슈 1건.
 * P1 정체 → P2 기한초과 → P3 과제없음 → P4 보고미작성 → P5 정상구간 중 diff≤−10
 */
function collectOpsChecks(company) {
  const rows = [];
  (company?.participants || []).forEach((participant) => {
    const schedule = scheduleStatus(company, participant);
    const tasks = participant.tasks || [];
    let code = null;

    if (schedule.reason === "stalled") code = "stalled";
    else if (tasks.some((task) => isTaskOverdue(task))) code = "overdue";
    else if (schedule.reason === "no-tasks") code = "no-tasks";
    else if (tasks.some((task) => !ensureTaskFields(task).reportCompleted)) code = "missing-report";
    else if (schedule.reason === "watch" && schedule.diff <= -10) code = "watch";

    if (!code) return;
    const meta = OPS_PRIORITY[code];
    rows.push({
      participant,
      schedule,
      code,
      priority: meta.priority,
      label: meta.label
    });
  });

  return rows.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (a.schedule.diff || 0) - (b.schedule.diff || 0);
  });
}

function stalledParticipants(company) {
  return collectOpsChecks(company).filter((row) => row.code === "stalled");
}

function companyAvg(company) {
  if (!company.participants.length) return 0;
  return Math.round(
    company.participants.reduce((sum, p) => sum + avgProgress(p), 0) / company.participants.length
  );
}

/**
 * 참여자 목표 달성율: 전체 진척도(실적) ÷ 협력사 일정 경과율(목표) × 100
 */
function targetAchievementRate(company, participant) {
  if (!participant?.tasks?.length) return null;
  const goal = companyElapsedRate(company);
  if (goal === null) return null;
  const actual = avgProgress(participant);
  if (goal === 0) return actual > 0 ? Math.max(100, actual) : 100;
  return Math.round((actual / goal) * 100);
}

function companyAchievementAvg(company) {
  const rates = (company?.participants || [])
    .map((p) => scheduleAchievementRate(p, company))
    .filter((v) => v !== null);
  if (!rates.length) return null;
  return Math.round(rates.reduce((sum, v) => sum + v, 0) / rates.length);
}

function companyTargetAchievementAvg(company) {
  const rates = (company?.participants || [])
    .map((p) => targetAchievementRate(company, p))
    .filter((v) => v !== null);
  if (!rates.length) return null;
  return Math.round(rates.reduce((sum, v) => sum + v, 0) / rates.length);
}

function progressClass(value) {
  if (value >= 70) return "green";
  if (value >= 40) return "blue";
  return "red";
}

/** 일정 상태 색: ≥0 양호(green) / ≥−15 정상(blue) / <−15 정체(red) */
function scheduleColorClass(diff, measurable = true) {
  if (!measurable) return "gray";
  if (diff >= 0) return "green";
  if (diff >= -15) return "blue";
  return "red";
}

/** 과제별 진척 vs 기대 진척 기준 색상 */
function taskScheduleClass(task, company) {
  return taskScheduleStatus(task, company).cls;
}

/** 과제별 일정 상태(라벨·색) */
function taskScheduleStatus(task, company) {
  const expected = taskExpectedProgress(task, company);
  if (expected === null) {
    return { label: "일정미설정", cls: "gray", expected: null, diff: 0 };
  }
  const progress = Number(ensureTaskFields(task).progress || 0);
  const diff = progress - expected;
  const base = { expected, diff };
  if (diff >= 0) return { label: "양호", cls: "green", ...base };
  if (diff >= -15) return { label: "정상", cls: "blue", ...base };
  return { label: "정체", cls: "red", ...base };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const current = new Date(now);
  if (current < start) return 1;
  const diffMs = current.getTime() - start.getTime();
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function ensureTaskFields(task) {
  if (!task) return null;
  task.weeklySummary ??= "";
  task.nextWeekPlan ??= "";
  task.instructorFeedback ??= "";
  task.startDate ??= "";
  task.endDate ??= "";
  task.goal ??= "";
  task.asIsProcess ??= "";
  task.toBeProcess ??= "";
  task.difficulty = normalizeDifficulty(task.difficulty);
  task.reportCompleted ??= Boolean(
    String(task.weeklySummary || "").trim() || String(task.nextWeekPlan || "").trim()
  );
  return task;
}

function ensureCompanyFields(company) {
  if (!company) return null;
  company.pmo ??= { name: "", email: "" };
  company.pmo.name ??= "";
  company.pmo.email ??= "";
  company.notices ??= [];
  company.participantUpdateRequest ??= {
    pending: false,
    message: "",
    requestedAt: null,
    acknowledgedAt: null
  };
  return company;
}

function parseProcessSteps(text) {
  return String(text || "")
    .split(/[\n>|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderProcessFlow(label, text) {
  const steps = parseProcessSteps(text);
  if (!steps.length) {
    return `<div class="process-block"><div class="process-label">${escapeHtml(label)}</div><p class="helper">등록된 프로세스가 없습니다.</p></div>`;
  }
  return `
    <div class="process-block">
      <div class="process-label">${escapeHtml(label)}</div>
      <div class="process-flow">
        ${steps
          .map(
            (step, i) => `
          ${i ? '<span class="process-arrow">→</span>' : ""}
          <span class="process-step">${escapeHtml(step)}</span>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

function parseCsvTasks(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  function splitCsvLine(line) {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        cells.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  const rows = lines.map(splitCsvLine);
  const header = rows[0].map((h) => h.toLowerCase());
  const hasHeader = ["과제명", "name", "task", "과제"].some((h) => header.includes(h));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const idx = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  return dataRows
    .map((cols) => {
      if (hasHeader) {
        const name = cols[idx(["과제명", "name", "task", "과제"])] || cols[0] || "";
        return {
          name,
          startDate: cols[idx(["시작일", "startdate", "start"])] || "",
          endDate: cols[idx(["완료일", "종료일", "enddate", "end"])] || "",
          goal: cols[idx(["성과목표", "성과 목표", "goal", "목표"])] || "",
          asIsProcess: cols[idx(["asis", "as-is", "as_is", "현재프로세스", "as-is 프로세스"])] || "",
          toBeProcess: cols[idx(["tobe", "to-be", "to_be", "개선프로세스", "to-be 프로세스"])] || "",
          progress: Number(cols[idx(["진척도", "progress"])] || 0) || 0,
          difficulty: normalizeDifficulty(cols[idx(["난이도", "difficulty", "level"])] || "중")
        };
      }
      return {
        name: cols[0] || "",
        startDate: cols[1] || "",
        endDate: cols[2] || "",
        goal: cols[3] || "",
        asIsProcess: cols[4] || "",
        toBeProcess: cols[5] || "",
        progress: Number(cols[6] || 0) || 0,
        difficulty: normalizeDifficulty(cols[7] || "중")
      };
    })
    .filter((row) => row.name.trim());
}

function taskReportText(task, key, emptyText) {
  if (!task) return emptyText;
  return task[key]?.trim() || emptyText;
}
