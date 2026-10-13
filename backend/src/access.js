const { StoreConflictError } = require("./store-changes");

class AccessError extends Error {
  constructor(message) {
    super(message);
    this.name = "AccessError";
    this.status = 403;
  }
}

function forbid() {
  throw new AccessError("이 항목을 수정할 권한이 없습니다.");
}

function indexData(data) {
  const companies = new Map();
  const participants = new Map();
  const tasks = new Map();
  for (const company of data?.companies || []) {
    companies.set(company.id, company);
    for (const participant of company.participants || []) {
      participants.set(participant.id, { company, participant });
      for (const task of participant.tasks || []) {
        tasks.set(task.id, { company, participant, task });
      }
    }
  }
  return { companies, participants, tasks };
}

function owns(actor, participantId) {
  return Boolean(actor.participantId && actor.participantId === participantId);
}

function inCompany(actor, companyId) {
  return actor.companyId === companyId;
}

function assertCompanyUpdate(actor, update) {
  if (actor.role === "admin") return;
  if (!inCompany(actor, update.id)) forbid();
  const setKeys = Object.keys(update.sets || {});
  if (update.pmoOps || update.memberOps || update.statOps || update.hierOps) forbid();
  if (actor.role === "pmo") {
    if (update.noticeOps) {
      /* 소속 협력사 공지 */
    }
    if (setKeys.some((key) => key !== "participantUpdateRequest")) forbid();
    return;
  }
  if (update.noticeOps) forbid();
  if (setKeys.some((key) => key !== "participantUpdateRequest")) forbid();
}

function assertTaskParticipant(actor, participantId) {
  if (actor.role === "admin") return;
  if (!owns(actor, participantId)) forbid();
}

function assertCanApply(actor, changes, data) {
  if (!actor?.role) forbid();
  const index = indexData(data);
  const createdTasks = new Map((changes.tasks?.created || []).map((row) => [row.id, row]));

  const participantOfTask = (taskId) => {
    const found = index.tasks.get(taskId);
    if (found) return found.participant.id;
    return createdTasks.get(taskId)?.participantId || null;
  };

  if (actor.role !== "admin") {
    if (changes.companies.created.length || changes.companies.deleted.length) forbid();
    if (changes.participants.deleted.length) forbid();
  }

  for (const row of changes.companies.updated) assertCompanyUpdate(actor, row);

  for (const row of changes.participants.created) {
    if (actor.role !== "admin" && !inCompany(actor, row.companyId)) forbid();
  }
  for (const row of changes.participants.updated) {
    if (actor.role !== "admin") forbid();
  }

  for (const row of changes.tasks.created) assertTaskParticipant(actor, row.participantId);
  for (const row of changes.tasks.updated) {
    const found = index.tasks.get(row.id);
    if (!found) throw new StoreConflictError("다른 사용자가 이 항목을 삭제했습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.");
    assertTaskParticipant(actor, found.participant.id);
    if (row.sets?.participantId && actor.role !== "admin") forbid();
  }
  for (const id of changes.tasks.deleted) {
    const found = index.tasks.get(id);
    if (!found) throw new StoreConflictError("다른 사용자가 이 항목을 삭제했습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.");
    assertTaskParticipant(actor, found.participant.id);
  }

  for (const row of [
    ...changes.weeklyReports.created,
    ...changes.weeklyReports.updated,
    ...changes.weeklyReports.deleted
  ]) {
    const participantId = participantOfTask(row.taskId);
    if (!participantId) {
      throw new StoreConflictError("다른 사용자가 이 항목을 삭제했습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.");
    }
    assertTaskParticipant(actor, participantId);
  }
}

module.exports = { AccessError, assertCanApply };
