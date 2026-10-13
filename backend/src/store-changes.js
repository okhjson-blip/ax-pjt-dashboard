const ENTITY_TYPES = ["companies", "participants", "tasks", "weeklyReports"];

class StoreConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "StoreConflictError";
    this.status = 409;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((row) => row != null) : [];
}

function normalizeChanges(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const type of ENTITY_TYPES) {
    const entry = source[type] && typeof source[type] === "object" ? source[type] : {};
    out[type] = {
      created: asArray(entry.created).filter((row) => typeof row === "object"),
      updated: asArray(entry.updated).filter((row) => typeof row === "object"),
      deleted: asArray(entry.deleted)
    };
  }
  for (const type of ["companies", "participants", "tasks"]) {
    const bucket = out[type];
    bucket.created = bucket.created.filter((row) => row.id);
    bucket.updated = bucket.updated.filter((row) => row.id);
    bucket.updated.forEach(assertUpdateShape);
    bucket.deleted = bucket.deleted.map(String).filter(Boolean);
  }
  const reports = out.weeklyReports;
  const validWeek = (row) => row.taskId && Number(row.weekNumber) >= 1;
  reports.created = reports.created.filter(validWeek);
  reports.updated = reports.updated.filter(validWeek);
  reports.updated.forEach(assertUpdateShape);
  reports.deleted = reports.deleted.filter((row) => typeof row === "object" && validWeek(row));
  return out;
}

function countChanges(changes) {
  return ENTITY_TYPES.reduce(
    (n, type) =>
      n + changes[type].created.length + changes[type].updated.length + changes[type].deleted.length,
    0
  );
}

function weeklyReportId(taskId, weekNumber) {
  return `twr-${taskId}-w${weekNumber}`;
}

const UPDATE_KEYS = new Set([
  "id",
  "sets",
  "noticeOps",
  "pmoOps",
  "memberOps",
  "statOps",
  "hierOps",
  "taskId",
  "weekNumber"
]);

const CONFLICT_MESSAGE =
  "다른 사용자가 같은 내용을 먼저 수정했습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.";
const MISSING_MESSAGE =
  "다른 사용자가 이 항목을 삭제했습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.";

function assertUpdateShape(row) {
  const unknown = Object.keys(row).filter((key) => !UPDATE_KEYS.has(key));
  if (unknown.length) {
    throw new StoreConflictError("화면이 최신 버전이 아닙니다. 새로고침(F5) 후 다시 저장해 주세요.");
  }
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function applySet(target, key, spec) {
  if (!spec || typeof spec !== "object" || !Object.prototype.hasOwnProperty.call(spec, "value")) {
    throw new StoreConflictError("화면이 최신 버전이 아닙니다. 새로고침(F5) 후 다시 저장해 주세요.");
  }
  if (!sameValue(target[key], spec.base)) throw new StoreConflictError(CONFLICT_MESSAGE);
  target[key] = spec.value;
}

function itemKey(item, kind) {
  if (kind === "id") return String(item?.id || "");
  const email = String(item?.email || "").trim().toLowerCase();
  if (email) return email;
  return `name:${String(item?.name || "").trim().toLowerCase()}`;
}

function applyKeyedOps(list, ops, kind) {
  const items = Array.isArray(list) ? list.slice() : [];
  for (const del of ops?.delete || []) {
    const idx = items.findIndex((item) => itemKey(item, kind) === del.id);
    if (idx < 0) continue;
    if (!sameValue(items[idx], del.base)) throw new StoreConflictError(CONFLICT_MESSAGE);
    items.splice(idx, 1);
  }
  for (const up of ops?.upsert || []) {
    const key = itemKey(up.value, kind);
    const idx = items.findIndex((item) => itemKey(item, kind) === key);
    if (idx < 0) {
      if (up.base != null) throw new StoreConflictError(CONFLICT_MESSAGE);
      items.push(up.value);
      continue;
    }
    if (up.base == null) {
      if (!sameValue(items[idx], up.value)) throw new StoreConflictError(CONFLICT_MESSAGE);
      continue;
    }
    if (!sameValue(items[idx], up.base)) throw new StoreConflictError(CONFLICT_MESSAGE);
    items[idx] = up.value;
  }
  return items;
}

function applyKeyOps(obj, sets) {
  const next = { ...(obj || {}) };
  for (const [key, spec] of Object.entries(sets || {})) {
    if (!sameValue(next[key], spec?.base)) throw new StoreConflictError(CONFLICT_MESSAGE);
    if (spec?.value == null) delete next[key];
    else next[key] = spec.value;
  }
  return next;
}

function requireRow(row) {
  if (!row) throw new StoreConflictError(MISSING_MESSAGE);
  return row;
}

function stripKeys(row, keys) {
  const copy = { ...row };
  keys.forEach((key) => delete copy[key]);
  return copy;
}

// 로컬 JSON 드라이버용: 중첩 구조(data.companies[].participants[].tasks[].weeklyReports[])에 변경분 적용
function applyChangesToNested(data, changes) {
  data.companies = Array.isArray(data.companies) ? data.companies : [];
  const companies = data.companies;
  const findCompany = (id) => companies.find((c) => c.id === id);
  const allParticipants = () => companies.flatMap((c) => (c.participants || []).map((p) => ({ company: c, p })));
  const allTasks = () => allParticipants().flatMap(({ p }) => (p.tasks || []).map((t) => ({ participant: p, t })));
  const findParticipant = (id) => allParticipants().find((row) => row.p.id === id);
  const findTask = (id) => allTasks().find((row) => row.t.id === id);
  const findReport = (taskId, weekNumber) => {
    const task = findTask(taskId)?.t;
    if (!task) return null;
    task.weeklyReports = task.weeklyReports || [];
    return task.weeklyReports.find((r) => Number(r.weekNumber) === Number(weekNumber)) || null;
  };

  for (const row of changes.weeklyReports.deleted) {
    const task = findTask(row.taskId)?.t;
    if (task) task.weeklyReports = (task.weeklyReports || []).filter((r) => Number(r.weekNumber) !== Number(row.weekNumber));
  }
  for (const id of changes.tasks.deleted) {
    const owner = findTask(id)?.participant;
    if (owner) owner.tasks = owner.tasks.filter((t) => t.id !== id);
  }
  for (const id of changes.participants.deleted) {
    const owner = findParticipant(id)?.company;
    if (owner) owner.participants = owner.participants.filter((p) => p.id !== id);
  }
  for (const id of changes.companies.deleted) {
    const idx = companies.findIndex((c) => c.id === id);
    if (idx >= 0) companies.splice(idx, 1);
  }

  for (const row of changes.companies.created) {
    const existing = findCompany(row.id);
    if (existing) Object.assign(existing, row);
    else companies.push({ ...row, participants: [] });
  }
  for (const row of changes.participants.created) {
    const company = findCompany(row.companyId);
    if (!company) throw new StoreConflictError("참여자를 등록할 협력사가 삭제되었습니다. 새로고침 후 다시 시도해 주세요.");
    company.participants = company.participants || [];
    const email = String(row.email || "").toLowerCase();
    const dup = company.participants.find((p) => p.id !== row.id && String(p.email || "").toLowerCase() === email);
    if (dup) throw new StoreConflictError("이미 등록된 이메일입니다. 기존 정보로 로그인해 주세요.");
    const existing = company.participants.find((p) => p.id === row.id);
    const value = stripKeys(row, ["companyId"]);
    if (existing) Object.assign(existing, value);
    else company.participants.push({ ...value, tasks: [] });
  }
  for (const row of changes.tasks.created) {
    const participant = findParticipant(row.participantId)?.p;
    if (!participant) throw new StoreConflictError("과제를 추가할 참여자가 삭제되었습니다. 새로고침 후 다시 시도해 주세요.");
    participant.tasks = participant.tasks || [];
    const existing = participant.tasks.find((t) => t.id === row.id);
    const value = stripKeys(row, ["participantId"]);
    if (existing) Object.assign(existing, value);
    else participant.tasks.push({ ...value, weeklyReports: [] });
  }
  for (const row of changes.weeklyReports.created) {
    const task = findTask(row.taskId)?.t;
    if (!task) throw new StoreConflictError("주간 보고를 저장할 과제가 삭제되었습니다. 새로고침 후 다시 시도해 주세요.");
    task.weeklyReports = task.weeklyReports || [];
    const value = { ...stripKeys(row, ["taskId"]), id: row.id || weeklyReportId(row.taskId, row.weekNumber) };
    const existing = findReport(row.taskId, row.weekNumber);
    if (existing) Object.assign(existing, value);
    else task.weeklyReports.push(value);
  }

  for (const row of changes.companies.updated) {
    const company = requireRow(findCompany(row.id));
    const sets = row.sets || {};
    if (sets.name) applySet(company, "name", sets.name);
    if (sets.schedule) applySet(company, "schedule", sets.schedule);
    if (sets.participantUpdateRequest) applySet(company, "participantUpdateRequest", sets.participantUpdateRequest);
    if (row.noticeOps) company.notices = applyKeyedOps(company.notices, row.noticeOps, "id");
    if (row.pmoOps) {
      company.pmo = company.pmo || { members: [] };
      company.pmo.members = applyKeyedOps(company.pmo.members, row.pmoOps, "email");
    }
  }
  for (const row of changes.participants.updated) {
    const found = requireRow(findParticipant(row.id));
    const sets = row.sets || {};
    if (sets.companyId && sets.companyId.value !== found.company.id) {
      if (!sameValue(found.company.id, sets.companyId.base)) throw new StoreConflictError(CONFLICT_MESSAGE);
      const target = findCompany(sets.companyId.value);
      if (!target) throw new StoreConflictError("참여자를 옮길 협력사가 삭제되었습니다. 새로고침 후 다시 시도해 주세요.");
      found.company.participants = found.company.participants.filter((p) => p.id !== row.id);
      target.participants = target.participants || [];
      target.participants.push(found.p);
    }
    for (const key of ["name", "email", "dept", "status", "summary", "nextWeekPlan", "instructorMemo", "registeredAt"]) {
      if (sets[key]) applySet(found.p, key, sets[key]);
    }
  }
  for (const row of changes.tasks.updated) {
    const found = requireRow(findTask(row.id));
    const sets = row.sets || {};
    if (sets.participantId && sets.participantId.value !== found.participant.id) {
      if (!sameValue(found.participant.id, sets.participantId.base)) throw new StoreConflictError(CONFLICT_MESSAGE);
      const target = findParticipant(sets.participantId.value)?.p;
      if (!target) throw new StoreConflictError("과제를 옮길 참여자가 삭제되었습니다. 새로고침 후 다시 시도해 주세요.");
      found.participant.tasks = found.participant.tasks.filter((t) => t.id !== row.id);
      target.tasks = target.tasks || [];
      target.tasks.push(found.t);
    }
    for (const key of [
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
      "projectName",
      "bdwSummary",
      "bdwDetail",
      "aiFit",
      "asIsProcessDetail"
    ]) {
      if (sets[key]) applySet(found.t, key, sets[key]);
    }
    if (row.hierOps) found.t.hierarchy = applyKeyOps(found.t.hierarchy, row.hierOps.sets);
    if (row.statOps) found.t.statistics = applyKeyOps(found.t.statistics, row.statOps.sets);
    if (row.memberOps) found.t.members = applyKeyedOps(found.t.members, row.memberOps, "email");
  }
  for (const row of changes.weeklyReports.updated) {
    const report = requireRow(findReport(row.taskId, row.weekNumber));
    const sets = row.sets || {};
    for (const key of [
      "progress",
      "weeklySummary",
      "weeklyDetail",
      "weeklyIssues",
      "nextWeekPlan",
      "instructorFeedback",
      "workStatus",
      "reportCompleted",
      "savedAt"
    ]) {
      if (sets[key]) applySet(report, key, sets[key]);
    }
  }
  return data;
}

module.exports = {
  ENTITY_TYPES,
  StoreConflictError,
  normalizeChanges,
  countChanges,
  weeklyReportId,
  applyChangesToNested
};
