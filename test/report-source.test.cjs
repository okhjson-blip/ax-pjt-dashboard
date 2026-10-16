const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');

for (const concurrent of [false,true]) test(`legacy report source backfill ${concurrent ? 'preserves a concurrent edit' : 'updates metadata only'}`,async()=>{
  const saved={id:'r1',companyId:'c1',weekNumber:1,updatedAt:'2026-10-01T00:00:00Z',source:{}};
  let row={id:'r1',company_id:'c1',week_number:1,status:'published',body:{weekSummary:'original'},source:{},updated_at:saved.updatedAt};
  if (concurrent) row={...row,body:{weekSummary:'new content'},updated_at:'2026-10-02T00:00:00Z'};
  const updates=[];
  // Simulates the remote compare-and-set boundary, exercising the real driver.
  const sb={from:()=>{
    const filters=[];let update;
    const query={update:value=>{update=value;updates.push(value);return query;},eq:(key,value)=>{filters.push([key,value]);return query;},select:()=>query,maybeSingle:async()=>{
      const matches=filters.every(([key,value])=>key==='source' ? JSON.stringify(row.source)===value : row[key]===value);
      if (!matches) return {data:null,error:null};
      if (update) row={...row,...update};
      return {data:row,error:null};
    }};
    return query;
  }};
  const filename=path.resolve(__dirname,'../backend/src/store-supabase.js');
  const originalRequire=createRequire(filename),mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:mod,require:id=>id==='./supabase'?{getSupabaseAdmin:()=>sb}:originalRequire(id),setTimeout});
  const result=await mod.exports.backfillCompanyWeeklyReportSource({...saved,source:{companySchedule:{startDate:'2026-09-01'}}},saved);
  assert.deepEqual(Object.keys(updates[0]),['source']);
  assert.equal(result.body.weekSummary,concurrent?'new content':'original');
  assert.equal(Boolean(result.source.companySchedule),!concurrent);
});
