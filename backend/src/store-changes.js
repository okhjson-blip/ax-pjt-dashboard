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
    bucket.deleted = bucket.deleted.map(String).filter(Boolean);
  }
  const reports = out.weeklyReports;
  const validWeek = (row) => row.taskId && Number(row.weekNumber) >= 1;
  reports.created = reports.created.filter(validWeek);
  reports.updated = reports.updated.filter(validWeek);
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
    const company = findCompany(row.id);
    if (company) Object.assign(company, stripKeys(row, ["id", "participants"]));
  }
  for (const row of changes.participants.updated) {
    const found = findParticipant(row.id);
    if (!found) continue;
    if (row.companyId && row.companyId !== found.company.id) {
      const target = findCompany(row.companyId);
      if (target) {
        found.company.participants = found.company.participants.filter((p) => p.id !== row.id);
        target.participants = target.participants || [];
        target.participants.push(found.p);
      }
    }
    Object.assign(found.p, stripKeys(row, ["id", "companyId", "tasks"]));
  }
  for (const row of changes.tasks.updated) {
    const found = findTask(row.id);
    if (!found) continue;
    if (row.participantId && row.participantId !== found.participant.id) {
      const target = findParticipant(row.participantId)?.p;
      if (target) {
        found.participant.tasks = found.participant.tasks.filter((t) => t.id !== row.id);
        target.tasks = target.tasks || [];
        target.tasks.push(found.t);
      }
    }
    Object.assign(found.t, stripKeys(row, ["id", "participantId", "weeklyReports"]));
  }
  for (const row of changes.weeklyReports.updated) {
    const report = findReport(row.taskId, row.weekNumber);
    if (report) Object.assign(report, stripKeys(row, ["id", "taskId", "weekNumber"]));
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
