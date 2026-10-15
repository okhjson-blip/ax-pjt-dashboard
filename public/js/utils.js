function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function today() {
  return new Date();
}

function normalizeDifficulty(value) {
  const raw = String(value || "중").trim().toLowerCase();
  if (raw === "상" || raw === "high" || raw === "h") return "상";
  if (raw === "하" || raw === "low" || raw === "l") return "하";
  if (raw === "중" || raw === "mid" || raw === "medium" || raw === "m") return "중";
  return "중";
}

const WORK_STATUSES = ["설계", "개발", "구축", "가동", "운영", "보류"];

function normalizeWorkStatus(value) {
  const raw = String(value || "").trim();
  return WORK_STATUSES.includes(raw) ? raw : "개발";
}

function workStatusSelectHtml(id, selected = "개발", disabled = false) {
  const value = normalizeWorkStatus(selected);
  const lock = disabled ? "disabled class='readonly difficulty-select'" : "class='difficulty-select'";
  return `
    <select id="${id}" ${lock}>
      ${WORK_STATUSES.map((item) => `<option value="${item}" ${value === item ? "selected" : ""}>${item}</option>`).join("")}
    </select>
  `;
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

/** 전체 진척도: 과제별 진척도의 단순 평균 */
function avgProgress(participant) {
  const tasks=participant?.tasks || [];
  if (!tasks.length) return 0;
  return Math.round(tasks.reduce((sum,t) => sum + Number(ensureTaskFields(t).progress || 0),0) / tasks.length);
}

/** 기대 진척도의 단순 평균. 계산 불가 과제는 제외. */
function expectedProgressAvg(participant, company) {
  const values=(participant?.tasks || []).map(t => taskExpectedProgress(t,company)).filter(v => v !== null);
  return values.length ? Math.round(values.reduce((sum,v) => sum+v,0) / values.length) : null;
}

/**
 * 일정 달성율: 과제별 min(실적 ÷ 기대, 1)의 단순 평균 × 100.
 * 목표 초과 실적은 100%로 제한하여 지연 과제를 상쇄하지 않는다.
 * 기대=0(시작 전) 과제는 제외. 전부 시작 전이면 100.
 */
function scheduleAchievementRate(participant, company) {
  const tasks = participant?.tasks || [];
  if (!tasks.length) return null;
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
    ratioSum += Math.min(1, Math.max(0, Number.isFinite(progress) ? progress / expected : 0));
    measurable += 1;
  });

  if (measurable) return Math.round((ratioSum / measurable) * 100);
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
  return avgProgress({tasks:(company?.participants || []).flatMap(p => p.tasks || [])});
}

/** 참여자 목표 달성율: 과제별 일정 목표 달성율의 단순 평균 */
function targetAchievementRate(company, participant) {
  return scheduleAchievementRate(participant,company);
}

function companyAchievementAvg(company) {
  return scheduleAchievementRate({tasks:(company?.participants || []).flatMap(p => p.tasks || [])},company);
}

function companyTargetAchievementAvg(company) {
  return companyAchievementAvg(company);
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

const TASK_STAT_FIELDS = [
  { key: "automationRate", csv: "automation_rate", label: "자동화율(%)", numeric: true },
  { key: "timeSavings", csv: "time_savings", label: "시간 절감(분)", numeric: true },
  { key: "timeSavingsRate", csv: "time_savings_rate", label: "시간 절감율(%)", numeric: true },
  { key: "asIsTotalTime", csv: "as_is_total_time", label: "As-Is 총 시간(분)", numeric: true },
  { key: "toBeTotalTime", csv: "to_be_total_time", label: "To-Be 총 시간(분)", numeric: true },
  { key: "asIsWaitingHours", csv: "as_is_waiting_hours", label: "As-Is 대기시간(시간)", numeric: true },
  { key: "fteEquivalent", csv: "fte_equivalent", label: "FTE", numeric: true },
  { key: "annualSavingsHours", csv: "annual_savings_hours", label: "연간 절감시간(시간)", numeric: true },
  { key: "totalProcesses", csv: "total_processes", label: "프로세스 수", numeric: true },
  { key: "automatedProcessCount", csv: "automated_process_count", label: "자동화 프로세스 수", numeric: true },
  { key: "frequencyUnit", csv: "frequency_unit", label: "빈도 단위", numeric: false },
  { key: "frequencyCount", csv: "frequency_count", label: "빈도 횟수", numeric: true },
  { key: "annualFrequency", csv: "annual_frequency", label: "연간 빈도", numeric: true },
  {
    key: "estimatedDevelopmentCost",
    csv: "estimated_development_cost",
    label: "추정 외주개발비용(원)",
    numeric: true
  }
];

const PERF_METRIC_MAIN_KEYS = [
  "automationRate",
  "timeSavings",
  "timeSavingsRate",
  "asIsTotalTime",
  "toBeTotalTime",
  "asIsWaitingHours",
  "fteEquivalent",
  "annualSavingsHours"
];

const PERF_METRIC_FOOTER_KEYS = ["totalProcesses", "automatedProcessCount", "estimatedDevelopmentCost"];

function parseNumericValue(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) return "";
  const num = Number(text);
  return Number.isFinite(num) ? String(num) : text;
}

function formatThousands(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const raw = text.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return text;
  const [intPart, frac] = raw.split(".");
  const signed = intPart.startsWith("-");
  const digits = signed ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const withSign = `${signed ? "-" : ""}${grouped}`;
  return frac != null ? `${withSign}.${frac}` : withSign;
}

function emptyHierarchy() {
  return { l1: "", l2: "", l3: "", l4: "" };
}

function emptyStatistics() {
  return TASK_STAT_FIELDS.reduce((acc, field) => {
    acc[field.key] = "";
    return acc;
  }, {});
}

function normalizeHierarchy(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    l1: src.l1 || "",
    l2: src.l2 || "",
    l3: src.l3 || "",
    l4: src.l4 || ""
  };
}

function normalizeStatistics(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const next = emptyStatistics();
  TASK_STAT_FIELDS.forEach((field) => {
    const value = src[field.key] ?? src[field.csv];
    if (value == null || value === "") {
      next[field.key] = "";
      return;
    }
    next[field.key] = field.numeric ? parseNumericValue(value) : String(value);
  });
  return next;
}

function normalizeMemberRole(role, isOwner = false) {
  const raw = String(role || "").trim();
  if (raw === "과제 리더") return "과제 리더";
  if (raw === "과제 담당자" || raw === "과제 등록자" || isOwner || !raw) return "과제 담당자";
  return "과제 담당자";
}

function normalizeTaskMember(raw, isOwner = false) {
  const src = raw && typeof raw === "object" ? raw : {};
  const owner = Boolean(src.isOwner || isOwner);
  return {
    name: src.name || "",
    role: normalizeMemberRole(src.role, owner),
    email: src.email || "",
    position: src.position || src.dept || "",
    isOwner: owner
  };
}

function mergeTaskMembers(ownerList, extraList) {
  const owners = (Array.isArray(ownerList) ? ownerList : [])
    .map((m) => normalizeTaskMember(m, true))
    .filter((m) => m.name);
  const seen = new Set(owners.map((m) => `${m.name}|${m.role}|${m.email}`.toLowerCase()));
  const extras = (Array.isArray(extraList) ? extraList : [])
    .map((m) => normalizeTaskMember(m, false))
    .filter((m) => {
      if (!m.name) return false;
      const key = `${m.name}|${m.role}|${m.email}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  extras.forEach((m) => {
    m.isOwner = false;
  });
  return [...owners, ...extras];
}

function parseJsonCell(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  const text = String(value).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_err) {
    try {
      return JSON.parse(text.replace(/""/g, '"'));
    } catch (_err2) {
      return null;
    }
  }
}

function methodLabel(method, aiApplied) {
  if (method === "manual") return "수작업";
  if (method === "ai" || aiApplied) return "자동화";
  return method || "";
}

function normalizeProcessMethod(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "manual" || raw === "수작업" || raw === "수동") return "manual";
  if (
    raw === "ai" ||
    raw === "자동화" ||
    raw === "auto" ||
    raw === "automated" ||
    raw === "자동화됨" ||
    raw === "ai 자동화" ||
    (raw.includes("ai") && raw.includes("자동"))
  ) {
    return "ai";
  }
  return "";
}

function emptyProcessStep(kind = "asis", sortOrder = 0) {
  const step = {
    name: "",
    sort_order: sortOrder,
    method: "",
    tool: "",
    execution_time: ""
  };
  if (kind === "tobe") {
    step.estimated_execution_time = "";
    step.difficulty = "중";
  }
  return step;
}

function parseNumericLoose(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

/** UI 시간(h) → 저장용 분(정수 문자열). 빈 값은 "". */
function hoursToMinutes(hours) {
  const n = parseNumericLoose(hours);
  if (n == null) return "";
  return String(Math.round(n * 60));
}

/** 저장용 분 → UI 시간(h) 입력값. 예: 90 → "1.5", 60 → "1" */
function minutesToHoursInput(minutes) {
  const n = parseNumericLoose(String(minutes ?? "").replace(/분\s*$/g, ""));
  if (n == null) return "";
  const hours = n / 60;
  if (Number.isInteger(hours)) return String(hours);
  return String(Math.round(hours * 10000) / 10000);
}

/** DSL/칩용: 분은 항상 "N분" */
function formatProcessMinutes(minutes) {
  const n = parseNumericLoose(String(minutes ?? "").replace(/분\s*$/g, ""));
  if (n == null) return "";
  return `${Math.round(n)}분`;
}

/** 미리보기 칩: 분은 시간 단위로 표시 */
function formatProcessHoursChip(minutes) {
  const hours = minutesToHoursInput(minutes);
  if (!hours) return "";
  return `${hours}시간`;
}

/** BPA export: "8h:00s" (h + 분) → 분 문자열 */
function parseHColonDurationToMinutes(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*h\s*:\s*(\d+)\s*s$/i);
  if (!match) return "";
  const h = parseNumericLoose(match[1]) || 0;
  const mm = parseNumericLoose(match[2]) || 0;
  return String(Math.round(h * 60 + mm));
}

/** "128h:00s" 등 → 시간(숫자). 성과 지표의 시간 단위 필드용 */
function parseDurationToHours(raw) {
  const minutes = parseHColonDurationToMinutes(raw);
  if (minutes) {
    const n = parseNumericLoose(minutes);
    return n == null ? "" : String(Math.round((n / 60) * 1000) / 1000);
  }
  const text = String(raw || "").trim();
  const hoursMatch = text.match(/^([\d.,]+)\s*(시간|h|hr|hrs|hours?)$/i);
  if (hoursMatch) {
    const n = parseNumericLoose(hoursMatch[1]);
    return n == null ? "" : String(n);
  }
  const n = parseNumericLoose(text.replace(/%/g, ""));
  return n == null ? "" : String(n);
}

function parsePercentValue(raw) {
  const text = String(raw || "").trim().replace(/%/g, "");
  const n = parseNumericLoose(text);
  return n == null ? "" : String(n);
}

function parseMoneyValue(raw) {
  const text = String(raw || "")
    .trim()
    .replace(/[₩\s,]/g, "");
  const n = parseNumericLoose(text);
  return n == null ? "" : String(Math.round(n));
}

/** "120분" | "2시간" | "1.5h" | "8h:00s" | "90" → 분 문자열 */
function parseDurationToMinutes(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const hColon = parseHColonDurationToMinutes(text);
  if (hColon) return hColon;
  const hoursMatch = text.match(/^([\d.,]+)\s*(시간|h|hr|hrs|hours?)$/i);
  if (hoursMatch) return hoursToMinutes(hoursMatch[1]);
  const minutesMatch = text.match(/^([\d.,]+)\s*분$/i);
  if (minutesMatch) {
    const n = parseNumericLoose(minutesMatch[1]);
    return n == null ? "" : String(Math.round(n));
  }
  const n = parseNumericLoose(text);
  return n == null ? "" : String(Math.round(n));
}

function sumProcessStepMinutes(steps, kind = "asis") {
  return (Array.isArray(steps) ? steps : []).reduce((sum, step) => {
    const raw =
      kind === "tobe"
        ? step.estimated_execution_time ?? step.execution_time ?? ""
        : step.execution_time ?? "";
    const n = parseNumericLoose(String(raw).replace(/분\s*$/g, ""));
    return sum + (n == null ? 0 : n);
  }, 0);
}

/** BPA 6단계 성과 계산용 상수 (criteria.md) */
const PERF_ANNUAL_FACTORS = {
  일: 365,
  day: 365,
  daily: 365,
  d: 365,
  주: 52,
  week: 52,
  weekly: 52,
  w: 52,
  월: 12,
  month: 12,
  monthly: 12,
  m: 12,
  년: 1,
  year: 1,
  yearly: 1,
  annual: 1,
  y: 1
};
const PERF_FTE_HOURS_PER_YEAR = 2248;
const PERF_DEV_COST_PER_AUTOMATED_STEP = 8321500;

function formatPerfNumber(value, digits) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  return Number(Number(value).toFixed(digits)).toString();
}

function isProcessStepPresent(step) {
  return Boolean(
    step &&
      (String(step.name || "").trim() ||
        String(step.tool || "").trim() ||
        String(step.method || "").trim() ||
        String(step.execution_time || "").trim() ||
        String(step.estimated_execution_time || "").trim())
  );
}

function resolveAnnualFrequencyFactor(unitRaw) {
  const unit = String(unitRaw || "").trim().toLowerCase();
  if (!unit) return null;
  if (PERF_ANNUAL_FACTORS[unit] != null) return PERF_ANNUAL_FACTORS[unit];
  const compact = unit.replace(/\s+/g, "");
  if (PERF_ANNUAL_FACTORS[compact] != null) return PERF_ANNUAL_FACTORS[compact];
  if (/일|day/.test(unit)) return 365;
  if (/주|week/.test(unit)) return 52;
  if (/월|month/.test(unit)) return 12;
  if (/년|year|annual/.test(unit)) return 1;
  return null;
}

/**
 * As-Is / To-Be 단계와 기존 통계(빈도 등)로 BPA 6단계 성과 지표를 산출한다.
 * 반환값은 채울 수 있는 필드만 포함하며, 산정 불가 항목은 넣지 않는다.
 */
function computePerformanceFromProcess(asIsSteps, toBeSteps, existingStats = {}) {
  const asIs = (Array.isArray(asIsSteps) ? asIsSteps : []).filter(isProcessStepPresent);
  const toBe = (Array.isArray(toBeSteps) ? toBeSteps : []).filter(isProcessStepPresent);
  const stats = existingStats && typeof existingStats === "object" ? existingStats : {};
  const computed = {};

  const asIsTotalTime = sumProcessStepMinutes(asIs, "asis");
  const toBeTotalTime = sumProcessStepMinutes(toBe, "tobe");
  if (asIs.length) computed.asIsTotalTime = formatPerfNumber(asIsTotalTime, 1);
  if (toBe.length) computed.toBeTotalTime = formatPerfNumber(toBeTotalTime, 1);

  if (asIs.length || toBe.length) {
    const savings = Math.max(0, asIsTotalTime - toBeTotalTime);
    computed.timeSavings = formatPerfNumber(savings, 1);
    if (asIsTotalTime > 0) {
      computed.timeSavingsRate = formatPerfNumber((savings / asIsTotalTime) * 100, 1);
    }
  }

  const totalProcesses = asIs.length || toBe.length;
  const automatedProcessCount = toBe.filter((step) => step.method === "ai").length;
  if (totalProcesses > 0) {
    computed.totalProcesses = String(totalProcesses);
    computed.automatedProcessCount = String(automatedProcessCount);
    computed.automationRate = formatPerfNumber((automatedProcessCount / totalProcesses) * 100, 1);
  }

  const waitingMinutes = asIs.reduce((sum, step) => {
    if (!/대기/.test(String(step.name || ""))) return sum;
    const n = parseNumericLoose(String(step.execution_time || "").replace(/분\s*$/g, ""));
    return sum + (n == null ? 0 : n);
  }, 0);
  if (waitingMinutes > 0) {
    computed.asIsWaitingHours = formatPerfNumber(waitingMinutes / 60, 1);
  }

  let annualFrequency = null;
  const count = parseNumericLoose(stats.frequencyCount);
  const factor = resolveAnnualFrequencyFactor(stats.frequencyUnit);
  if (count != null && factor != null) {
    // 연간 수행 횟수 = 기간당 횟수 × 환산계수(일 365 / 주 52 / 월 12 / 년 1)
    annualFrequency = count * factor;
    computed.annualFrequency = formatPerfNumber(annualFrequency, 1);
  } else {
    computed.annualFrequency = "";
  }

  const savingsMinutes = parseNumericLoose(computed.timeSavings);
  if (annualFrequency != null && savingsMinutes != null && asIsTotalTime > 0) {
    // 모든 단계가 매회 실행·사람 투입시간 기준일 때: 건당 절감 × 연간 횟수 ÷ 60
    const annualSavingsHours = (savingsMinutes * annualFrequency) / 60;
    computed.annualSavingsHours = formatPerfNumber(annualSavingsHours, 1);
    computed.fteEquivalent = formatPerfNumber(annualSavingsHours / PERF_FTE_HOURS_PER_YEAR, 3);
  } else {
    computed.annualSavingsHours = "";
    computed.fteEquivalent = "";
  }

  if (automatedProcessCount > 0) {
    computed.estimatedDevelopmentCost = String(
      automatedProcessCount * PERF_DEV_COST_PER_AUTOMATED_STEP
    );
  }

  return computed;
}

function formatProcessFromSteps(steps, kind = "asis") {
  if (!Array.isArray(steps) || !steps.length) return "";
  const sorted = [...steps].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  return sorted
    .map((step) => {
      const name = String(step.name || "").trim();
      const method = methodLabel(step.method, step.ai_applied);
      const tool = String(step.tool || step.automation_method || "").trim();
      const minutes =
        kind === "tobe"
          ? step.estimated_execution_time ?? step.execution_time ?? ""
          : step.execution_time ?? "";
      const minutesStr = formatProcessMinutes(minutes);
      if (kind === "tobe") {
        const difficulty = normalizeDifficulty(step.difficulty);
        const hasMeta = method || tool || minutesStr;
        if (!hasMeta) return name;
        return `${name} [${method}｜${tool}｜${minutesStr}｜난이도 ${difficulty}]`;
      }
      const hasMeta = method || tool || minutesStr;
      if (!hasMeta) return name;
      return `${name} [${method}｜${tool}｜${minutesStr}]`;
    })
    .filter(Boolean)
    .join(" > ");
}

function parseProcessStepToken(token, kind = "asis", sortOrder = 0) {
  const text = String(token || "").trim();
  if (!text) return null;
  const step = emptyProcessStep(kind, sortOrder);
  const matched = text.match(/^(.+?)\s*\[([^\]]*)\]\s*$/);
  if (!matched) {
    step.name = text;
    return step;
  }
  step.name = matched[1].trim();
  const parts = matched[2].split(/[|｜]/).map((part) => part.trim());
  step.method = normalizeProcessMethod(parts[0] || "");
  step.tool = parts[1] || "";
  const minutesRaw = parseDurationToMinutes(parts[2] || "");
  step.execution_time = minutesRaw;
  if (kind === "tobe") {
    step.estimated_execution_time = minutesRaw;
    const diffPart = parts[3] || "";
    const diffMatch = diffPart.match(/(상|중|하|high|mid|medium|low|h|m|l)/i);
    step.difficulty = normalizeDifficulty(diffMatch ? diffMatch[1] : "중");
  }
  return step;
}

function parseProcessFromText(text, kind = "asis") {
  return parseProcessSteps(text)
    .map((token, index) => parseProcessStepToken(token, kind, index + 1))
    .filter(Boolean);
}

function ensureTaskFields(task) {
  if (!task) return null;
  task.weeklySummary ??= "";
  task.weeklyDetail ??= "";
  task.weeklyIssues ??= "";
  task.nextWeekPlan ??= "";
  task.instructorFeedback ??= "";
  task.workStatus = normalizeWorkStatus(task.workStatus);
  task.startDate ??= "";
  task.endDate ??= "";
  task.goal ??= "";
  task.asIsProcess ??= "";
  task.toBeProcess ??= "";
  task.difficulty = normalizeDifficulty(task.difficulty);
  task.hierarchy = normalizeHierarchy(task.hierarchy);
  task.statistics = normalizeStatistics(task.statistics);
  task.members = Array.isArray(task.members)
    ? task.members.map((m) => normalizeTaskMember(m, Boolean(m.isOwner)))
    : [];
  task.projectName ??= "";
  task.bdwSummary ??= "";
  task.bdwDetail ??= "";
  task.aiFit ??= "";
  task.asIsProcessDetail ??= "";
  if (!Array.isArray(task.weeklyReports)) task.weeklyReports = [];
  task.reportCompleted ??= Boolean(
    String(task.weeklySummary || "").trim() || String(task.nextWeekPlan || "").trim()
  );
  return task;
}

const PMO_POSITION_TITLES = [
  "부사장",
  "본부장",
  "상무보",
  "상무",
  "전무",
  "이사",
  "부장",
  "차장",
  "과장",
  "대리",
  "주임",
  "사원",
  "팀장",
  "실장",
  "수석",
  "책임",
  "선임"
];

function splitLegacyPmoList(value) {
  return String(value || "")
    .split(/[,，、;；|/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitLegacyNamePosition(raw) {
  const text = String(raw || "").trim();
  if (!text) return { name: "", position: "" };
  for (const title of PMO_POSITION_TITLES) {
    const matched = text.match(new RegExp(`^(.+?)\\s+${title}$`));
    if (matched && matched[1].trim()) return { name: matched[1].trim(), position: title };
  }
  return { name: text, position: "" };
}

function normalizePmo(pmo) {
  const source = pmo && typeof pmo === "object" ? pmo : {};
  if (Array.isArray(source.members)) {
    return {
      members: source.members
        .map((row) => ({
          name: String(row?.name || "").trim(),
          position: String(row?.position || "").trim(),
          email: String(row?.email || "").trim()
        }))
        .filter((row) => row.name || row.position || row.email)
    };
  }
  const names = splitLegacyPmoList(source.name);
  const emails = splitLegacyPmoList(source.email);
  const count = Math.max(names.length, emails.length);
  const members = [];
  for (let index = 0; index < count; index += 1) {
    const parsed = splitLegacyNamePosition(names[index] || "");
    members.push({
      name: parsed.name,
      position: parsed.position,
      email: emails[index] || ""
    });
  }
  return { members: members.filter((row) => row.name || row.position || row.email) };
}

/** 개인 대시보드·협력사 허브·레포트가 함께 세는 참여자. 과제가 없는 PMO 행은 제외한다. */
function countedParticipants(company) {
  const pmoEmails = new Set(
    normalizePmo(company?.pmo).members
      .map((member) => String(member.email || "").trim().toLowerCase())
      .filter(Boolean)
  );
  return (company?.participants || []).filter((participant) => {
    const email = String(participant?.email || "").trim().toLowerCase();
    return !pmoEmails.has(email) || (participant.tasks || []).length > 0;
  });
}

function ensureCompanyFields(company) {
  if (!company) return null;
  company.pmo = normalizePmo(company.pmo);
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
  // 노드 구분: ">"(전각 ＞ 포함) 또는 줄바꿈. "|" / "｜"는 노드 내부 메타(도구·시간)로 유지.
  return String(text || "")
    .split(/\n+/)
    .flatMap((line) => line.split(/\s*[>＞]\s*/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderProcessStepChips(step, kind = "asis") {
  const chips = [];
  const method = methodLabel(step.method, step.ai_applied);
  if (method) chips.push(method);
  const tool = String(step.tool || step.automation_method || "").trim();
  if (tool) chips.push(tool);
  const minutes =
    kind === "tobe"
      ? step.estimated_execution_time ?? step.execution_time ?? ""
      : step.execution_time ?? "";
  const hoursChip = formatProcessHoursChip(minutes);
  if (hoursChip) chips.push(hoursChip);
  if (kind === "tobe" && String(step.difficulty || "").trim()) {
    chips.push(`난이도 ${normalizeDifficulty(step.difficulty)}`);
  }
  if (!chips.length) return "";
  return `<span class="process-step-chips">${chips
    .map((chip) => `<span class="process-chip">${escapeHtml(chip)}</span>`)
    .join("")}</span>`;
}

function renderProcessFlow(label, textOrSteps, layout = "horizontal", kind = "asis") {
  const steps = Array.isArray(textOrSteps)
    ? textOrSteps.filter((step) => step && (step.name || step.tool || step.method || step.execution_time || step.estimated_execution_time))
    : parseProcessFromText(textOrSteps, kind);
  const vertical = layout === "vertical";
  if (!steps.length) {
    return `<div class="process-block"><div class="process-label">${escapeHtml(label)}</div><p class="helper">등록된 프로세스가 없습니다.</p></div>`;
  }
  return `
    <div class="process-block ${vertical ? "process-block-vertical" : ""}">
      <div class="process-label">${escapeHtml(label)}</div>
      <div class="process-flow ${vertical ? "vertical" : ""}">
        ${steps
          .map(
            (step, i) => `
          ${i ? `<span class="process-arrow ${vertical ? "vertical" : ""}">${vertical ? "↓" : "→"}</span>` : ""}
          <span class="process-step">
            <span class="process-step-title">${escapeHtml(step.name || "이름 없음")}</span>
            ${renderProcessStepChips(step, kind)}
          </span>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

function parseCsvParticipantsText(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = parseJsonCell(text);
    if (Array.isArray(parsed)) return parsed.map((m) => normalizeTaskMember(m));
  }
  return text
    .split(/\s*[>＞]\s*/)
    .map((segment) => {
      const parts = segment.split(/\s*\/\s*/).map((p) => p.trim());
      if (!parts[0]) return null;
      const roleText = parts[2] || "";
      const isLeader = /리더/.test(roleText);
      return normalizeTaskMember(
        {
          name: parts[0] || "",
          position: parts[1] || "",
          role: roleText,
          email: parts[3] || ""
        },
        isLeader
      );
    })
    .filter(Boolean);
}

function parseCsvFrequencyText(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};
  const result = {};
  const unitMatch = text.match(/^(일|주|월|년)/);
  if (unitMatch) result.frequencyUnit = unitMatch[1];
  const countMatch = text.match(/(\d+(?:\.\d+)?)\s*회/);
  if (countMatch) result.frequencyCount = parseNumericValue(countMatch[1]);
  const annualMatch = text.match(/연간\s*(\d+(?:\.\d+)?)\s*회/);
  if (annualMatch) result.annualFrequency = parseNumericValue(annualMatch[1]);
  return result;
}

function sumAsIsWaitingHoursFromDetail(raw) {
  const text = String(raw || "");
  if (!text) return "";
  let totalMinutes = 0;
  const re = /대기\s*(\d+(?:\.\d+)?)\s*h/gi;
  let m;
  while ((m = re.exec(text))) {
    const part = `${m[1]}h:00s`;
    const mins = parseNumericLoose(parseHColonDurationToMinutes(part));
    if (mins != null) totalMinutes += mins;
  }
  if (totalMinutes <= 0) return "";
  return String(Math.round((totalMinutes / 60) * 1000) / 1000);
}

function hierarchyFromCsvColumns(cols, idx, base) {
  const h = normalizeHierarchy(base);
  const l1 = cols[idx(["l1 구분", "l1", "l1 대분류"])] || "";
  const l2 = cols[idx(["l2 대분류", "l2", "l2 중분류"])] || "";
  const l3Col = cols[idx(["l3 중분류", "l3", "l3 소분류"])] || "";
  const l3 = l3Col || cols[idx(["프로젝트명", "project_name", "project"])] || "";
  const l4 = cols[idx(["l4 모듈", "l4", "l4 세부분류"])] || "";
  if (l1) h.l1 = l1;
  if (l2) h.l2 = l2;
  if (l3) h.l3 = l3;
  if (l4) h.l4 = l4;
  return h;
}

function statisticsFromCsvColumns(cols, idx, baseStats) {
  const stats = normalizeStatistics(baseStats);
  const setIf = (key, value) => {
    if (value == null || value === "") return;
    stats[key] = value;
  };

  setIf("asIsTotalTime", parseDurationToMinutes(cols[idx(["as-is 수행시간", "asis 수행시간", "as_is_total_time"])] || ""));
  setIf("toBeTotalTime", parseDurationToMinutes(cols[idx(["to-be 수행시간", "tobe 수행시간", "to_be_total_time"])] || ""));
  setIf("timeSavings", parseDurationToMinutes(cols[idx(["건당 절감시간", "time_savings"])] || ""));
  setIf("timeSavingsRate", parsePercentValue(cols[idx(["시간 절감률", "time_savings_rate"])] || ""));
  setIf("automationRate", parsePercentValue(cols[idx(["자동화율", "automation_rate"])] || ""));
  setIf(
    "annualSavingsHours",
    parseDurationToHours(cols[idx(["연간 절감시간", "annual_savings_hours"])] || "")
  );
  setIf("fteEquivalent", parseNumericValue(cols[idx(["절감 fte", "fte_equivalent", "절감fte"])] || ""));
  setIf(
    "estimatedDevelopmentCost",
    parseMoneyValue(cols[idx(["추정 외주개발비", "추정 외주개발비용", "estimated_development_cost"])] || "")
  );

  const freq = parseCsvFrequencyText(cols[idx(["수행 빈도", "frequency", "frequency_text"])] || "");
  setIf("frequencyUnit", freq.frequencyUnit || "");
  setIf("frequencyCount", freq.frequencyCount || "");
  setIf("annualFrequency", freq.annualFrequency || "");

  const waitHours = sumAsIsWaitingHoursFromDetail(
    cols[idx(["as-is 상세", "asis 상세", "as_is_detail"])] || ""
  );
  setIf("asIsWaitingHours", waitHours);

  return stats;
}

function pickCsvProcessRaw(cols, idx, kind) {
  const isAsIs = kind === "asis";
  const jsonRaw =
    cols[
      idx(
        isAsIs
          ? ["as_is_processes_json", "as-is processes json"]
          : ["to_be_processes_json", "to-be processes json"]
      )
    ] || "";
  const json = parseJsonCell(jsonRaw);
  if (Array.isArray(json)) return formatProcessFromSteps(json, kind);

  const detail =
    cols[
      idx(
        isAsIs
          ? ["as-is 상세", "asis 상세", "as_is_detail"]
          : ["to-be 상세", "tobe 상세", "to_be_detail"]
      )
    ] || "";
  const simple =
    cols[
      idx(
        isAsIs
          ? ["asis", "as-is", "as_is", "현재프로세스", "as-is 프로세스"]
          : ["tobe", "to-be", "to_be", "개선프로세스", "to-be 프로세스"]
      )
    ] || "";
  if (isAsIs) return String(simple || detail || "").trim();
  return String(detail || simple || "").trim();
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
  const hasHeader = [
    "과제명",
    "name",
    "task",
    "과제",
    "task_name",
    "csv_schema_version"
  ].some((h) => header.includes(h));
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
        const name =
          cols[idx(["과제명", "name", "task", "과제", "task_name"])] || cols[0] || "";
        const statsJson = parseJsonCell(cols[idx(["statistics_json", "statistics", "통계"])] || "");
        const hierarchyJson = parseJsonCell(cols[idx(["hierarchy_json", "hierarchy", "계층"])] || "");
        let hierarchy = normalizeHierarchy(hierarchyJson);
        hierarchy = hierarchyFromCsvColumns(cols, idx, hierarchy);

        let statistics = statisticsFromCsvColumns(cols, idx, statsJson || {});

        const membersCol =
          cols[idx(["과제 참여자", "task_participants_json", "members", "참여자"])] || "";
        let members = parseCsvParticipantsText(membersCol);
        const membersJson = parseJsonCell(membersCol);
        if (!members.length && Array.isArray(membersJson)) {
          members = membersJson.map((m) => normalizeTaskMember(m));
        }

        const difficultyRaw =
          cols[idx(["난이도", "difficulty", "level"])] ||
          cols[idx(["ai 자동화 구현 난이도", "automation_difficulty"])] ||
          statsJson?.automation_difficulty ||
          "중";

        const asIsProcess = pickCsvProcessRaw(cols, idx, "asis");
        const toBeProcess = pickCsvProcessRaw(cols, idx, "tobe");

        return {
          name,
          startDate:
            cols[idx(["시작일", "startdate", "start", "task_start_date"])] || "",
          endDate:
            cols[idx(["완료일", "종료일", "enddate", "end", "task_end_date"])] || "",
          goal:
            cols[idx(["과제 목표", "과제목표", "성과목표", "성과 목표", "goal", "목표", "task_goal"])] || "",
          asIsProcess,
          toBeProcess,
          progress: Number(cols[idx(["진척도", "progress"])] || 0) || 0,
          difficulty: normalizeDifficulty(difficultyRaw),
          hierarchy,
          statistics,
          members,
          projectName: cols[idx(["프로젝트명", "project_name", "project"])] || "",
          bdwSummary: cols[idx(["bdw 요약", "bdw_summary"])] || "",
          bdwDetail: cols[idx(["bdw 상세", "bdw_detail"])] || "",
          aiFit: cols[idx(["ai fit", "ai_fit"])] || "",
          asIsProcessDetail:
            cols[idx(["as-is 상세", "asis 상세", "as_is_detail"])] || ""
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
        difficulty: normalizeDifficulty(cols[7] || "중"),
        hierarchy: emptyHierarchy(),
        statistics: emptyStatistics(),
        members: []
      };
    })
    .filter((row) => row.name.trim() && !["csv_schema_version", "과제명", "name", "task_name"].includes(row.name.trim()));
}

function taskReportText(task, key, emptyText) {
  if (!task) return emptyText;
  return task[key]?.trim() || emptyText;
}

const DASHBOARD_ENTITY_FIELDS = {
  companies: ["name", "schedule", "pmo", "notices", "participantUpdateRequest"],
  participants: [
    "companyId",
    "name",
    "email",
    "dept",
    "status",
    "summary",
    "nextWeekPlan",
    "instructorMemo",
    "registeredAt"
  ],
  tasks: [
    "participantId",
    "name",
    "progress",
    "weeklySummary",
    "weeklyDetail",
    "weeklyIssues",
    "nextWeekPlan",
    "instructorFeedback",
    "reportCompleted",
    "workStatus",
    "startDate",
    "endDate",
    "goal",
    "asIsProcess",
    "toBeProcess",
    "difficulty",
    "hierarchy",
    "statistics",
    "members",
    "projectName",
    "bdwSummary",
    "bdwDetail",
    "aiFit",
    "asIsProcessDetail"
  ],
  weeklyReports: [
    "id",
    "taskId",
    "weekNumber",
    "progress",
    "weeklySummary",
    "weeklyDetail",
    "weeklyIssues",
    "nextWeekPlan",
    "instructorFeedback",
    "workStatus",
    "reportCompleted",
    "savedAt"
  ]
};

function pickDashboardFields(source, fields, extra = {}) {
  const row = {};
  const merged = { ...source, ...extra };
  fields.forEach((key) => {
    row[key] = merged[key] === undefined ? null : merged[key];
  });
  return JSON.parse(JSON.stringify(row));
}

// 엔티티별 평면 스냅샷. 저장 시 이 기준점과 비교해 바뀐 행·필드만 서버로 보낸다.
function snapshotDashboard(companies) {
  const snap = { companies: {}, participants: {}, tasks: {}, weeklyReports: {} };
  (companies || []).forEach((company) => {
    snap.companies[company.id] = pickDashboardFields(company, DASHBOARD_ENTITY_FIELDS.companies);
    (company.participants || []).forEach((participant) => {
      snap.participants[participant.id] = pickDashboardFields(participant, DASHBOARD_ENTITY_FIELDS.participants, {
        companyId: company.id
      });
      (participant.tasks || []).forEach((task) => {
        snap.tasks[task.id] = pickDashboardFields(task, DASHBOARD_ENTITY_FIELDS.tasks, {
          participantId: participant.id
        });
        (task.weeklyReports || []).forEach((report) => {
          const weekNumber = Number(report.weekNumber || 0);
          if (!weekNumber || weekNumber < 1) return;
          snap.weeklyReports[`${task.id}:${weekNumber}`] = pickDashboardFields(
            report,
            DASHBOARD_ENTITY_FIELDS.weeklyReports,
            { taskId: task.id, weekNumber }
          );
        });
      });
    });
  });
  return snap;
}

function changed(left, right) {
  return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
}

function memberKey(member) {
  const email = String(member?.email || "").trim().toLowerCase();
  if (email) return email;
  return `name:${String(member?.name || "").trim().toLowerCase()}`;
}

function diffKeyedList(prevList, nextList, keyOf) {
  if (!changed(prevList || [], nextList || [])) return null;
  const prev = new Map((prevList || []).map((item) => [keyOf(item), item]));
  const next = new Map();
  const upsert = [];
  const deleted = [];
  (nextList || []).forEach((item) => {
    const key = keyOf(item);
    if (!key) return;
    next.set(key, item);
    const before = prev.get(key);
    if (!before) upsert.push({ value: item, base: null });
    else if (changed(before, item)) upsert.push({ value: item, base: before });
  });
  prev.forEach((item, key) => {
    if (!next.has(key)) deleted.push({ id: key, base: item });
  });
  if (!upsert.length && !deleted.length) return null;
  return { upsert, delete: deleted };
}

function diffObjectKeys(prev, next) {
  const sets = {};
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  keys.forEach((key) => {
    if (changed(prev?.[key], next?.[key])) sets[key] = { value: next?.[key] ?? null, base: prev?.[key] ?? null };
  });
  return Object.keys(sets).length ? { sets } : null;
}

function buildUpdate(type, id, prev, row) {
  const update = type === "weeklyReports" ? { taskId: row.taskId, weekNumber: row.weekNumber } : { id };
  const sets = {};
  const scalarFields = {
    companies: ["name", "schedule", "participantUpdateRequest"],
    participants: DASHBOARD_ENTITY_FIELDS.participants,
    tasks: DASHBOARD_ENTITY_FIELDS.tasks.filter(
      (field) => !["hierarchy", "statistics"].includes(field)
    ),
    weeklyReports: DASHBOARD_ENTITY_FIELDS.weeklyReports.filter(
      (field) => !["id", "taskId", "weekNumber"].includes(field)
    )
  };
  scalarFields[type].forEach((field) => {
    if (changed(prev[field], row[field])) sets[field] = { value: row[field], base: prev[field] };
  });
  if (Object.keys(sets).length) update.sets = sets;

  if (type === "companies") {
    const noticeOps = diffKeyedList(prev.notices, row.notices, (item) => item.id);
    const pmoOps = diffKeyedList(prev.pmo?.members, row.pmo?.members, memberKey);
    if (noticeOps) update.noticeOps = noticeOps;
    if (pmoOps) update.pmoOps = pmoOps;
  }
  if (type === "tasks") {
    const hierOps = diffObjectKeys(prev.hierarchy, row.hierarchy);
    const statOps = diffObjectKeys(prev.statistics, row.statistics);
    // Members are an ordered list: the same email may have several roles.
    if (hierOps) update.hierOps = hierOps;
    if (statOps) update.statOps = statOps;

  }
  const hasOps = update.noticeOps || update.pmoOps || update.hierOps || update.statOps || update.memberOps;
  if (!update.sets && !hasOps) return null;
  return update;
}

function buildDashboardChanges(baseline, companies) {
  const base = baseline || { companies: {}, participants: {}, tasks: {}, weeklyReports: {} };
  const current = snapshotDashboard(companies);
  const changes = {};
  Object.keys(DASHBOARD_ENTITY_FIELDS).forEach((type) => {
    const before = base[type] || {};
    const after = current[type];
    const created = [];
    const updated = [];
    const deleted = [];
    Object.keys(after).forEach((key) => {
      const row = after[key];
      const prev = before[key];
      if (!prev) {
        created.push({ ...row, id: type === "weeklyReports" ? row.id : key });
        return;
      }
      const update = buildUpdate(type, key, prev, row);
      if (update) updated.push(update);
    });
    Object.keys(before).forEach((key) => {
      if (after[key]) return;
      if (type === "weeklyReports") deleted.push({ taskId: before[key].taskId, weekNumber: before[key].weekNumber });
      else deleted.push(key);
    });
    if (created.length || updated.length || deleted.length) changes[type] = { created, updated, deleted };
  });
  return changes;
}

function hasDashboardChanges(changes) {
  return Object.keys(changes || {}).length > 0;
}
