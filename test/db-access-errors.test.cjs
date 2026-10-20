const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../backend/src/store-supabase.js');
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports.mapChangeError=mapChangeError;', { require: createRequire(file), module: mod });
test('database permission details become a distinct, actionable API error', () => {
  const error = mod.exports.mapChangeError({ code: '42501', details: 'TASK_OWNER_MISMATCH' });
  assert.equal(error.code, 'TASK_OWNER_MISMATCH');
  assert.equal(error.source, 'database');
  assert.equal(error.status, 403);
  assert.match(error.message, /등록자/);
});
test('unknown database denial details are not exposed to users', () => {
  const error = mod.exports.mapChangeError({ code: '42501', details: 'internal table permissions' });
  assert.equal(error.code, 'DB_PERMISSION_DENIED');
  assert.equal(error.source, 'database');
  assert.doesNotMatch(error.message, /internal table/);
});
