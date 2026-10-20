const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeChanges, applyChangesToNested } = require('../backend/src/store-changes');
const { assertCanApply, scopeDashboard } = require('../backend/src/access');

function fixture({ registered = false, peer = true } = {}) {
  return { companies: [{
    id: 'c1', name: 'Company', pmo: { members: [{ name: 'PMO', email: 'pmo@example.com' }] },
    participants: [
      ...(peer ? [{ id: 'peer', name: 'Peer', email: 'peer@example.com', dept: 'Team', tasks: [{ id: 'peer-task', name: 'Peer task' }] }] : []),
      ...(registered ? [{ id: 'self', name: 'PMO', email: 'pmo@example.com', dept: 'Team', tasks: [] }] : [])
    ]
  }] };
}

function harness(data, { role = 'pmo', participantId = null, view = 'personal', failFirstSave = false } = {}) {
  let stored = structuredClone(data);
  let actor = { role, companyId: 'c1', participantId, name: 'PMO', email: 'pmo@example.com', token: 'initial' };
  let saves = 0;
  const listeners = {}, session = new Map();
  const elements = {
    app: { innerHTML: '' }, toast: { appendChild() {} },
    'new-name': { value: 'PMO' }, 'new-email': { value: ' PMO@example.com ' }, 'new-dept': { value: 'Team' },
    'task-name': { value: 'First PMO task' }
  };
  const storage = { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) };
  const API = {
    setToken() {},
    getDashboard: async () => scopeDashboard(actor, structuredClone(stored)),
    session: async () => {
      actor = { ...actor, participantId: stored.companies[0].participants.find(p => p.email === actor.email)?.id || null, token: 'refreshed' };
      return { ...actor };
    },
    saveDashboardChanges: async changes => {
      if (failFirstSave && ++saves === 1) throw Object.assign(new Error('Temporary failure'), { status: 503 });
      const normalized = normalizeChanges(changes);
      assertCanApply(actor, normalized, stored);
      applyChangesToNested(stored, normalized);
      return scopeDashboard(actor, structuredClone(stored));
    }
  };
  const ctx = vm.createContext({
    console, API, Date, Math, setTimeout: () => 0, clearTimeout() {}, sessionStorage: storage, localStorage: storage,
    window: { confirm: () => true, alert() {} },
    document: {
      getElementById: id => elements[id] || null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ remove() {} }), addEventListener: (name, fn) => { listeners[name] = fn; }
    }
  });
  const root = path.resolve(__dirname, '..');
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/js/task-access.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(root, 'public/js/utils.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8').replace(
    /  bootstrap\(\);\s*\}\)\(\);\s*$/,
    'globalThis.audit={state,applyDashboardData,renderPersonalDashboard,renderCompanyHub,render};})();'
  ), ctx);
  ctx.audit.applyDashboardData(scopeDashboard(actor, structuredClone(stored)));
  Object.assign(ctx.audit.state, { loading: false, auth: { ...actor }, view, selectedCompanyId: 'c1', selectedParticipantId: 'peer', selectedTaskId: 'peer-task' });
  return {
    ...ctx.audit, elements, session,
    stored: () => stored,
    click: (action, dataset = {}) => listeners.click({ target: { closest: selector => selector === '[data-action]' ? { dataset: { action, ...dataset } } : null } })
  };
}

test('taskless registered PMO is selectable and can add the first task', () => {
  const ui = harness(fixture({ registered: true }), { participantId: 'self' });
  ui.state.selectedParticipantId = 'self';
  const html = ui.renderPersonalDashboard();
  assert.match(html, /data-action="select-person" data-company="c1" data-participant="self"/);
  assert.match(html, /data-action="open-add-task" data-company="c1" data-participant="self"/);
});

test('taskless PMO alone can reach their personal dashboard', () => {
  const ui = harness(fixture({ registered: true, peer: false }), { participantId: 'self' });
  assert.match(ui.renderPersonalDashboard(), /data-action="open-add-task"/);
});

for (const view of ['personal', 'company']) {
  test(`PMO self registration from ${view} selects self and allows first task save`, async () => {
    const ui = harness(fixture(), { view });
    Object.assign(ui.state, { modal: 'addParticipant', form: { companyId: 'c1' } });
    await ui.click('add-participant');
    const own = ui.stored().companies[0].participants.find(p => p.email === 'pmo@example.com');
    assert.ok(own);
    assert.equal(ui.state.auth.participantId, own.id);
    assert.equal(ui.state.selectedParticipantId, own.id);
    assert.equal(ui.state.selectedTaskId, null);
    assert.equal(ui.state.view, 'personal');
    const saved = JSON.parse(ui.session.get('ax-dashboard-session'));
    assert.equal(saved.selectedParticipantId, own.id);
    await ui.click('open-add-task', { company: 'c1', participant: own.id });
    assert.equal(ui.state.modal, 'addTask');
    await ui.click('add-task');
    assert.equal(ui.state.modal, null);
    assert.equal(ui.stored().companies[0].participants.find(p => p.id === own.id).tasks[0].name, 'First PMO task');
  });
}

test('self registration retry selects the saved draft without duplicating the participant', async () => {
  const ui = harness(fixture(), { failFirstSave: true });
  Object.assign(ui.state, { modal: 'addParticipant', form: { companyId: 'c1' } });
  await ui.click('add-participant');
  assert.equal(ui.state.modal, 'addParticipant');
  assert.equal(ui.state.selectedParticipantId, 'peer');
  await ui.click('add-participant');
  const own = ui.stored().companies[0].participants.filter(p => p.email === 'pmo@example.com');
  assert.equal(own.length, 1);
  assert.equal(ui.state.selectedParticipantId, own[0].id);
});

test('registering another participant does not change PMO selection or view', async () => {
  const ui = harness(fixture(), { view: 'company' });
  ui.elements['new-name'].value = 'New colleague';
  ui.elements['new-email'].value = 'new@example.com';
  Object.assign(ui.state, { modal: 'addParticipant', form: { companyId: 'c1' } });
  await ui.click('add-participant');
  assert.equal(ui.state.selectedParticipantId, 'peer');
  assert.equal(ui.state.view, 'company');
  assert.equal(ui.state.auth.participantId, null);
});

test('separating the personal list preserves hub counts and peer task restrictions', () => {
  const ui = harness(fixture({ registered: true }), { participantId: 'self' });
  const hub = ui.renderCompanyHub();
  assert.match(hub, /총 참여자<\/div>\s*<div class="stat-value">1<\/div>/);
  assert.doesNotMatch(hub, /data-participant="self"/);
  ui.state.selectedParticipantId = 'peer';
  assert.doesNotMatch(ui.renderPersonalDashboard(), /data-action="open-add-task"/);
});
