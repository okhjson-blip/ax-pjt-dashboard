const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { assertCanApply, scopeDashboard } = require('../backend/src/access');
const { normalizeChanges, applyChangesToNested } = require('../backend/src/store-changes');

function harness({ fail = false, email = 'owner@example.com', role = 'participant' } = {}) {
  const data = { companies: [{ id: 'c1', name: 'Company', pmo: { members: [{ name: 'Owner', email: 'owner@example.com' }] }, participants: [
    { id: 'p1', name: 'Owner', email: 'owner@example.com', dept: 'Team', tasks: [{ id: 't1', name: 'Own task', asIsProcess: 'Original process', projectName: 'Original project', goal: 'Original goal', statistics: {}, members: [] }, { id: 't2', name: 'Second task' }] },
    { id: 'p2', name: 'Peer', email: 'peer@example.com', tasks: [{ id: 't3', name: 'Peer task' }] }
  ] }] };
  const actor = { role, companyId: 'c1', participantId: 'p1', name: 'Owner', email };
  let stored = structuredClone(data);
  let failure = fail, saveHook = null;
  const calls = [], listeners = {}, messages = [];
  const elements = { app: { innerHTML: '' }, toast: { appendChild: el => messages.push(el.textContent) },
    'detail-task-name': { value: 'Own task' }, 'detail-task-goal': { value: 'Changed goal' }, 'detail-task-project-name': { value: 'Changed project' } };
  const card = { querySelector: selector => ({ value: ({ '.process-step-name': 'Changed process', '.process-step-hours': '2', '.process-step-method': '수작업' })[selector] || '' }) };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const API = { setToken() {}, saveDashboardChanges: async changes => {
    calls.push(structuredClone(changes));
    if (failure) throw Object.assign(new Error('Temporary failure'), { status: 503 });
    if (saveHook) await saveHook();
    assertCanApply(actor, normalizeChanges(changes), stored);
    applyChangesToNested(stored, normalizeChanges(changes));
    return scopeDashboard(actor, structuredClone(stored));
  } };
  const ctx = vm.createContext({ console, Date, Math, API, setTimeout: () => 0, clearTimeout() {}, localStorage: storage, sessionStorage: storage,
    window: { confirm: () => true, alert() {} }, document: {
      getElementById: id => elements[id] || null, querySelector: () => null,
      querySelectorAll: selector => selector === '#process-asis-list .process-step-card' ? [card] : [],
      createElement: () => ({ remove() {} }), addEventListener: (name, handler) => { listeners[name] = handler; }
    } });
  const root = path.resolve(__dirname, '..');
  const policyPath = path.join(root, 'public/js/task-access.js');
  vm.runInContext(fs.readFileSync(policyPath, 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/utils.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8').replace(/  bootstrap\(\);\s*\}\)\(\);\s*$/,
    'globalThis.audit={state,applyDashboardData,renderTaskDetailModal,renderCompanyHub,persist};})();'), ctx);
  ctx.audit.applyDashboardData(structuredClone(data));
  Object.assign(ctx.audit.state, { loading: false, auth: actor, view: 'personal', selectedCompanyId: 'c1', selectedParticipantId: 'p1', selectedTaskId: 't1', modal: 'taskDetail', form: { taskId: 't1' } });
  return { ...ctx.audit, ctx, actor, calls, messages, elements, stored: () => stored,
    setFail: value => { failure = value; }, onSave: fn => { saveHook = fn; },
    click: (action, section) => listeners.click({ target: { closest: selector => selector === '[data-action]' ? { dataset: { action, section } } : null } }) };
}

test('process mid-save sends only its task process/statistics and preserves other drafts', async () => {
  const ui = harness();
  const company = ui.state.companies[0], own = company.participants[0];
  company.name = 'Unrelated company draft';
  own.tasks[0].goal = 'Unrelated basics draft';
  own.tasks[1].name = 'Unrelated second task draft';
  company.participants[1].tasks[0].name = 'Unrelated peer draft';
  await ui.click('save-task-section', 'process');
  assert.equal(ui.calls.length, 1);
  assert.deepEqual(Object.keys(ui.calls[0]), ['tasks']);
  assert.equal(ui.calls[0].tasks.updated.length, 1);
  const update = ui.calls[0].tasks.updated[0];
  assert.equal(update.id, 't1');
  assert.deepEqual(Object.keys(update.sets).sort(), ['asIsProcess']);
  assert.match(ui.stored().companies[0].participants[0].tasks[0].asIsProcess, /Changed process/);
  assert.equal(ui.stored().companies[0].name, 'Company');
  assert.equal(ui.state.companies[0].name, 'Unrelated company draft');
  assert.equal(ui.state.companies[0].participants[0].tasks[0].goal, 'Unrelated basics draft');
  assert.equal(ui.state.companies[0].participants[0].tasks[1].name, 'Unrelated second task draft');
  assert.equal(ui.state.companies[0].participants[1].tasks[0].name, 'Unrelated peer draft');
  assert.equal(ui.state.baseline.tasks.t1.asIsProcess, ui.stored().companies[0].participants[0].tasks[0].asIsProcess);
  assert.equal(ui.state.baseline.tasks.t1.goal, 'Original goal');
});

test('full detail save excludes other tasks, company and weekly report changes', async () => {
  const ui = harness();
  const company = ui.state.companies[0];
  company.name = 'Unsaved company';
  company.participants[0].tasks[0].weeklySummary = 'Unsaved weekly report';
  company.participants[0].tasks[1].name = 'Unsaved second task';
  await ui.click('save-task-detail');
  assert.deepEqual(Object.keys(ui.calls[0]), ['tasks']);
  assert.equal(ui.calls[0].tasks.updated.length, 1);
  assert.equal(ui.calls[0].tasks.updated[0].sets.weeklySummary, undefined);
  assert.equal(ui.stored().companies[0].participants[0].tasks[0].goal, 'Changed goal');
  assert.equal(ui.state.companies[0].participants[0].tasks[0].weeklySummary, 'Unsaved weekly report');
  assert.equal(ui.state.companies[0].participants[0].tasks[1].name, 'Unsaved second task');
  assert.equal(ui.state.baseline.companies.c1.name, 'Company');
});

test('failed scoped save retains baseline and can retry only the selected section', async () => {
  const ui = harness({ fail: true });
  const before = JSON.stringify(ui.state.baseline);
  await ui.click('save-task-section', 'process');
  assert.equal(JSON.stringify(ui.state.baseline), before);
  assert.match(ui.state.companies[0].participants[0].tasks[0].asIsProcess, /Changed process/);
  assert.equal(ui.state.modal, 'taskDetail');
  ui.setFail(false);
  await ui.click('save-task-section', 'process');
  assert.match(ui.stored().companies[0].participants[0].tasks[0].asIsProcess, /Changed process/);
  assert.equal(ui.calls[1].tasks.updated.length, 1);
});

test('basics mid-save leaves process and project drafts pending', async () => {
  const ui = harness();
  ui.state.companies[0].participants[0].tasks[0].asIsProcess = 'Unsent process';
  ui.state.companies[0].participants[0].tasks[0].projectName = 'Unsent project';
  await ui.click('save-task-section', 'basics');
  assert.equal(ui.calls[0].tasks.updated[0].sets.asIsProcess, undefined);
  assert.equal(ui.calls[0].tasks.updated[0].sets.projectName, undefined);
  assert.equal(ui.stored().companies[0].participants[0].tasks[0].goal, 'Changed goal');
  assert.equal(ui.state.companies[0].participants[0].tasks[0].asIsProcess, 'Unsent process');
  assert.equal(ui.state.baseline.tasks.t1.asIsProcess, 'Original process');
});

test('process statistics are saved together with process text', async () => {
  const ui = harness();
  ui.elements['detail-task-stat-asIsTotalTime'] = { value: '120' };
  await ui.click('save-task-section', 'process');
  assert.equal(ui.calls[0].tasks.updated[0].statOps.sets.asIsTotalTime.value, '120');
  assert.equal(String(ui.stored().companies[0].participants[0].tasks[0].statistics.asIsTotalTime), '120');
});

test('successful scoped save does not overwrite an edit made while saving', async () => {
  const ui = harness();
  ui.onSave(() => { ui.state.companies[0].participants[0].tasks[0].asIsProcess = 'Newer local draft'; });
  await ui.click('save-task-section', 'process');
  assert.equal(ui.state.companies[0].participants[0].tasks[0].asIsProcess, 'Newer local draft');
  assert.match(ui.state.baseline.tasks.t1.asIsProcess, /Changed process/);
});

test('new task mid-save creates only that section and later saves another section', async () => {
  const ui = harness();
  ui.state.companies[0].participants[0].tasks.push({ id: 'new', name: 'New task', asIsProcess: 'Unsent process', goal: '', tasks: [] });
  Object.assign(ui.state, { modal: 'addTask', form: { companyId: 'c1', participantId: 'p1', draftTaskId: 'new' } });
  ui.elements['task-name'] = { value: 'New task' };
  ui.elements['task-goal'] = { value: 'New goal' };
  await ui.click('save-task-section', 'basics');
  assert.equal(ui.calls[0].tasks.created.length, 1);
  assert.equal(ui.calls[0].tasks.created[0].asIsProcess, undefined);
  assert.equal(ui.stored().companies[0].participants[0].tasks.find(t => t.id === 'new').goal, 'New goal');
  await ui.click('save-task-section', 'process');
  assert.equal(ui.calls[1].tasks.created.length, 0);
  assert.equal(ui.calls[1].tasks.updated[0].id, 'new');
  assert.match(ui.stored().companies[0].participants[0].tasks.find(t => t.id === 'new').asIsProcess, /Changed process/);
});

test('unchanged process section does not submit unrelated drafts', async () => {
  const ui = harness();
  await ui.click('save-task-section', 'process');
  ui.state.companies[0].name = 'Pending company name';
  await ui.click('save-task-section', 'process');
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.state.companies[0].name, 'Pending company name');
});

test('scoped basics save refreshes the participant hub projection', async () => {
  const ui = harness();
  ui.elements['detail-task-name'].value = 'Updated hub task';
  await ui.click('save-task-section', 'basics');
  assert.match(ui.renderCompanyHub(), /Updated hub task/);
});

test('UI denies editing when the participant email differs from the session', () => {
  const ui = harness({ email: 'stale@example.com' });
  assert.doesNotMatch(ui.renderTaskDetailModal(), /data-action="save-task-detail"/);
  assert.match(ui.renderTaskDetailModal(), /이메일/);
});

test('UI denies a revoked PMO even if their participant ID still matches', () => {
  const ui = harness({ role: 'pmo' });
  ui.state.companies[0].pmo.members = [];
  assert.doesNotMatch(ui.renderTaskDetailModal(), /data-action="save-task-detail"/);
  assert.match(ui.renderTaskDetailModal(), /PMO/);
});

for (const [mutate, code] of [
  [actor => { actor.email = 'stale@example.com'; }, 'PARTICIPANT_EMAIL_MISMATCH'],
  [actor => { actor.companyId = 'c2'; }, 'TASK_COMPANY_MISMATCH'],
  [actor => { actor.participantId = null; }, 'PARTICIPANT_LINK_REQUIRED'],
  [actor => { actor.participantId = 'p2'; }, 'TASK_OWNER_MISMATCH']
]) test(`server identifies task denial: ${code}`, () => {
  const ui = harness();
  mutate(ui.actor);
  assert.throws(() => assertCanApply(ui.actor, normalizeChanges({ tasks: { updated: [{ id: 't1', sets: { asIsProcess: { base: 'Original process', value: 'Changed' } } }] } }), ui.stored()),
    err => err.status === 403 && err.code === code && err.message !== '이 항목을 수정할 권한이 없습니다.');
});
