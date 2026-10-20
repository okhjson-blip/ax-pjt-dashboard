const { StoreConflictError } = require('./store-changes');
const { taskEditAccess, denied } = require('../../public/js/task-access');

class AccessError extends Error {
  constructor(message, code = 'ACCESS_DENIED', source = 'server') {
    super(message || denied(code).message);
    this.name = 'AccessError'; this.status = 403; this.code = code; this.source = source;
  }
}
const forbid = (code = 'ACCESS_DENIED') => { throw new AccessError(null, code); };
function indexData(data) {
  const companies = new Map(), participants = new Map(), tasks = new Map();
  for (const company of data?.companies || []) {
    companies.set(company.id, company);
    for (const participant of company.participants || []) {
      participants.set(participant.id, {company, participant});
      for (const task of participant.tasks || []) tasks.set(task.id, {company, participant, task});
    }
  }
  return {companies, participants, tasks};
}
const owns = (actor, id) => Boolean(actor.participantId && actor.participantId === id);
function assertActorActive(actor, data) {
  if (!actor?.role) forbid('AUTH_ROLE_INVALID');
  if (actor.role === 'admin') return;
  const company = (data.companies || []).find(c => c.id === actor.companyId);
  if (!company) forbid('COMPANY_ACCESS_DENIED');
  if (actor.role === 'pmo') {
    const {matchesCompanyPmo} = require('./pmo');
    if (!matchesCompanyPmo(company, actor.name, actor.email)) forbid('PMO_MEMBERSHIP_CHANGED');
  } else if (actor.role === 'participant') {
    const p = company.participants.find(p => p.id === actor.participantId);
    if (!actor.participantId) forbid('PARTICIPANT_LINK_REQUIRED');
    if (!p) forbid('PARTICIPANT_NOT_FOUND');
    if (String(p.email || '').toLowerCase().trim() !== String(actor.email || '').toLowerCase().trim()) forbid('PARTICIPANT_EMAIL_MISMATCH');
  } else forbid('AUTH_ROLE_INVALID');
}
function assertCompanyRead(actor, companyId, data, {report = false} = {}) {
  assertActorActive(actor, data);
  if (actor.role === 'admin') return;
  if (actor.companyId !== companyId || (report && actor.role !== 'pmo')) forbid();
}
// Keep hub summaries outside the personal write snapshot.
function scopeDashboard(actor, data) {
  assertActorActive(actor, data);
  if (actor.role === 'admin') return data;
  const ownCompanies=data.companies.filter(c => c.id === actor.companyId);
  const companies=ownCompanies.map(c => ({...c,participants:c.participants.filter(p => actor.role === 'pmo' || owns(actor,p.id))}));
  const result={companies,meta:{lastSavedAt:data.meta?.lastSavedAt || null}};
  if (actor.role === 'participant') {
    const taskKeys=['id','name','progress','difficulty','workStatus','startDate','endDate','reportCompleted'];
    result.hubCompanies=ownCompanies.map(c => ({...c,participants:c.participants.map(p => ({
      id:p.id,name:p.name,email:p.email,dept:p.dept,status:p.status,
      tasks:(p.tasks || []).map(t => ({...Object.fromEntries(taskKeys.filter(k => k in t).map(k => [k,t[k]])),hasInstructorFeedback:Boolean(String(t.instructorFeedback || '').trim())}))
    }))}));
  }
  return result;
}
function assertCanApply(actor, changes, data) {
  if (!['admin','pmo','participant'].includes(actor?.role)) forbid();
  const index = indexData(data);
  const createdTasks = new Map();
  const duplicate = () => { throw new StoreConflictError('이미 존재하는 항목입니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.'); };
  for (const [type,map] of [['companies',index.companies],['participants',index.participants],['tasks',index.tasks]]) {
    const ids = new Set();
    for (const row of changes[type].created) { if (map.has(row.id) || ids.has(row.id)) duplicate(); ids.add(row.id); }
  }
  if (actor.role !== 'admin' && (changes.companies.created.length || changes.companies.deleted.length)) forbid('COMPANY_WRITE_DENIED');
  for (const row of changes.companies.updated) {
    if (actor.role === 'admin') continue;
    if (actor.role !== 'pmo' || row.id !== actor.companyId || row.pmoOps || row.memberOps || row.statOps || row.hierOps) forbid('COMPANY_WRITE_DENIED');
    if (Object.keys(row.sets || {}).some(k => k !== 'participantUpdateRequest')) forbid('COMPANY_WRITE_DENIED');
  }
  const manageParticipant = companyId => { if (actor.role !== 'admin' && (actor.role !== 'pmo' || actor.companyId !== companyId)) forbid(); };
  for (const row of changes.participants.created) { manageParticipant(row.companyId); if (!index.companies.has(row.companyId)) forbid(); }
  for (const row of changes.participants.updated) {
    const found=index.participants.get(row.id); if (!found) throw new StoreConflictError('참여자가 삭제되었습니다.');
    if (actor.role === 'participant') {
      if (!owns(actor,row.id) || found.company.id !== actor.companyId || Object.keys(row.sets || {}).some(k => !['name','email','dept'].includes(k))) forbid();
    } else manageParticipant(found.company.id);
    if (actor.role !== 'admin' && row.sets?.companyId && row.sets.companyId.value !== actor.companyId) forbid();
  }
  for (const id of changes.participants.deleted) { const found=index.participants.get(id); if (!found) throw new StoreConflictError('참여자가 삭제되었습니다.'); manageParticipant(found.company.id); }
  const taskOwner = id => index.tasks.get(id)?.participant.id || createdTasks.get(id)?.participantId;
  const manageTask = id => {
    if (actor.role === 'admin') return;
    const profile = index.participants.get(id);
    const result = taskEditAccess(actor, profile?.company, profile?.participant);
    if (!result.allowed) forbid(result.code);
  };
  for (const row of changes.tasks.created) { if (!index.participants.has(row.participantId) && !changes.participants.created.some(p => p.id === row.participantId)) forbid(); manageTask(row.participantId); createdTasks.set(row.id,row); }
  for (const row of changes.tasks.updated) { const found=index.tasks.get(row.id); if (!found) throw new StoreConflictError('과제가 삭제되었습니다.'); manageTask(found.participant.id); if (actor.role !== 'admin' && row.sets?.participantId) forbid('TASK_OWNER_CHANGE_DENIED'); }
  for (const id of changes.tasks.deleted) { const owner=taskOwner(id); if (!owner) throw new StoreConflictError('과제가 삭제되었습니다.'); manageTask(owner); }
  const reportKeys = new Set();
  for (const row of changes.weeklyReports.created) {
    const task=index.tasks.get(row.taskId)?.task;
    const key=row.taskId + ':' + row.weekNumber;
    if (reportKeys.has(key) || task?.weeklyReports?.some(r => Number(r.weekNumber) === Number(row.weekNumber))) duplicate();
    reportKeys.add(key);
  }
  for (const row of [...changes.weeklyReports.created,...changes.weeklyReports.updated,...changes.weeklyReports.deleted]) { const owner=taskOwner(row.taskId); if (!owner) throw new StoreConflictError('과제가 삭제되었습니다.'); manageTask(owner); }
}
module.exports = {AccessError,assertCanApply,scopeDashboard,assertActorActive,assertCompanyRead};
