const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const appRequire=createRequire(path.join(root,'package.json'));
const db=new PGlite();
const rows=[];
const pw=crypto.randomUUID();
process.env.ADMIN_PASSWORD=pw;
process.env.SESSION_SECRET=crypto.randomUUID();
let server,base;
const mod={exports:{}};
const mapperFile=path.join(root,'backend/src/store-supabase.js');
vm.runInNewContext(fs.readFileSync(mapperFile,'utf8')+'\nmodule.exports.maps={mapCompanyRow,mapParticipantRow,mapTaskRow,mapWeeklyReportRow};',
  {require:createRequire(mapperFile),module:mod,console,setTimeout});
const maps=mod.exports.maps;
async function service(fn){await db.exec('set role service_role');try{return await fn();}finally{await db.exec('reset role');}}
const store={
  isSupabaseConfigured:()=>true,
  uid:prefix=>prefix+'-'+crypto.randomUUID(),
  readData:()=>service(async()=>{
    const companies=(await db.query('select * from companies order by id')).rows;
    const participants=(await db.query('select * from participants order by id')).rows;
    const tasks=(await db.query('select * from tasks order by id')).rows;
    const reports=(await db.query('select * from task_weekly_reports order by id')).rows;
    return {companies:companies.map(c=>maps.mapCompanyRow(c,participants.filter(p=>p.company_id===c.id).map(p=>maps.mapParticipantRow(p,tasks.filter(t=>t.participant_id===p.id).map(t=>maps.mapTaskRow(t,reports.filter(w=>w.task_id===t.id).map(maps.mapWeeklyReportRow))))))),meta:{}};
  }),
  applyChanges:async (raw,actor=null)=>{
    const {normalizeChanges,StoreConflictError}=appRequire('./backend/src/store-changes');
    const changes=normalizeChanges(raw);
    try{return await service(()=>actor ? db.query('select apply_authorized_dashboard_changes($1::jsonb,$2::jsonb)',[JSON.stringify(changes),JSON.stringify(actor)]) : db.query('select apply_dashboard_changes($1::jsonb)',[JSON.stringify(changes)]));}
    catch(e){if(e.code==='P0001')throw new StoreConflictError(e.message);if(e.code==='42501')throw new (appRequire('./backend/src/access').AccessError)();throw e;}
  },
  updateMeta:async()=>({}),
  getCompanyWeeklyReport:async()=>null,
  upsertCompanyWeeklyReport:async doc=>service(async()=>{
    await db.query('insert into company_weekly_reports(id,company_id,week_number,body,status) values($1,$2,$3,$4,$5) on conflict(company_id,week_number) do update set body=excluded.body,status=excluded.status',[doc.id,doc.companyId,doc.weekNumber,JSON.stringify(doc.body),doc.status]);return doc;
  })
};
async function fixture(){
  await db.exec('reset role;truncate public.companies cascade');
  await db.query("insert into companies(id,name,start_date,end_date,extras) values('c1','Company One','2026-10-01','2026-12-31',$1),('c2','Company Two','2026-10-01','2026-12-31',$2)",[
    JSON.stringify({pmo:{members:[{name:'Alice',email:'alice@example.com'},{name:'PMO Only',email:'pmo@example.com'}]},notices:[{id:'n1',title:'Original',content:'Original'}],participantUpdateRequest:{pending:false}}),
    JSON.stringify({pmo:{members:[]},notices:[],participantUpdateRequest:{pending:false}})]);
  await db.exec("insert into participants(id,company_id,name,email) values('p1','c1','Alice','alice@example.com'),('p2','c1','Bob','bob@example.com'),('p3','c2','Charlie','charlie@example.com');insert into tasks(id,participant_id,name,weekly_summary,next_week_plan,extras) values('t1','p1','Alice task','Original','Original','{}'),('t2','p2','Bob task','Original','Original','{}'),('t3','p3','Charlie task','Original','Original','{}');");
}
async function api(url,actor,method='GET',body){
  const headers={'Content-Type':'application/json'};
  if(actor)headers.Authorization='Bearer '+tokens[actor];
  const response=await fetch(base+'/api'+url,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
}
const tokens={};
async function check(name,expected,run){
  await fixture();const actual=await run();const status=actual.status;
  const pass=(Array.isArray(expected)?expected.includes(status):expected===status)&&!actual.policyViolation;
  const row={name,expected,status,pass,...(actual.evidence?{evidence:actual.evidence}:{})};
  if(status>=400)row.error=actual.body?.error;
  if(actual.policyViolation)row.policyViolation=actual.policyViolation;
  rows.push(row);
}
function taskUpdate(id,key,baseValue,value){return {tasks:{updated:[{id,sets:{[key]:{base:baseValue,value}}}]}};}
function companyUpdate(id,sets){return {companies:{updated:[{id,sets}]}};}
function patch(actor,changes){return api('/dashboard',actor,'PATCH',{changes});}
function uiAudit(data){
  const listeners={};const elements={};const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  const ctx=vm.createContext({console,Date,setTimeout,clearTimeout,API:{setToken:()=>{}},localStorage:storage,sessionStorage:storage,
    window:{alert:()=>{},confirm:()=>true},document:{getElementById:id=>elements[id]||=( {innerHTML:'',addEventListener:()=>{}}),addEventListener:(name,fn)=>listeners[name]=fn,querySelector:()=>null,querySelectorAll:()=>[]}});
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/utils.js'),'utf8'),ctx);
  const src=fs.readFileSync(path.join(root,'public/js/app.js'),'utf8').replace(/  bootstrap\(\);\s*\}\)\(\);\s*$/,
    'globalThis.audit={state,applyDashboardData,renderTopActions,renderPersonalDashboard,renderTaskDetailModal,renderCompanyHub,canViewParticipant,canManageParticipant,canManageNotices,lockToOwnParticipant};})();');
  vm.runInContext(src,ctx);
  const a=ctx.audit;
  const out=[];
  for(const [name,auth,pid] of [
    ['admin_other',{role:'admin'},'p2'],
    ['pmo_own',{role:'pmo',companyId:'c1',participantId:'p1'},'p1'],
    ['pmo_colleague',{role:'pmo',companyId:'c1',participantId:'p1'},'p2'],
    ['participant_own',{role:'participant',companyId:'c1',participantId:'p2'},'p2'],
    ['participant_colleague',{role:'participant',companyId:'c1',participantId:'p2'},'p1'],
    ['pmo_without_participant',{role:'pmo',companyId:'c1',participantId:null},'p1']]){
    a.applyDashboardData(structuredClone(data));Object.assign(a.state,{auth,view:'personal',selectedCompanyId:'c1',selectedParticipantId:pid,selectedTaskId:pid==='p1'?'t1':'t2',selectedWeek:null,form:{taskId:pid==='p1'?'t1':'t2'}});
    const personal=a.renderPersonalDashboard();const detail=a.renderTaskDetailModal();
    a.state.view='company';const hub=a.renderTopActions()+a.renderCompanyHub();
    out.push({name,requestedParticipant:pid,renderedParticipant:a.state.selectedParticipantId,reportSave:personal.includes('data-action="save-personal"'),reportSummaryReadonly:/id="weekly-summary"[^>]*readonly/.test(personal),taskSave:detail.includes('data-action="save-task-detail"'),taskDelete:personal.includes('data-action="delete-task"'),personalOverview:personal.includes('참여자 전체 현황'),personalOwnEdit:personal.includes('data-action="edit-participant" data-company="c1" data-participant="p2"'),personalPeerListed:personal.includes('data-action="select-person" data-company="c1" data-participant="p1"'),personalDelete:personal.includes('data-action="delete-participant"'),hubOverview:hub.includes('참여자 전체 현황'),personalBlocked:personal.includes('본인 과제만 열람할 수 있습니다.'),hubAddParticipant:hub.includes('data-action="open-add-participant"'),hubNoticeCreate:hub.includes('data-action="open-add-notice"'),hubScheduleEdit:hub.includes('data-action="open-schedule"'),hubParticipantDelete:hub.includes('data-action="delete-participant"')});
  }
  a.state.auth={role:'pmo',companyId:'c1',participantId:'p1'};a.state.selectedParticipantId='p2';a.lockToOwnParticipant();
  out.push({name:'pmo_personal_navigation',selectedParticipantAfterLock:a.state.selectedParticipantId,expected:'p1'});
  return out;
}
(async()=>{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls');
  const migrationDir=path.join(root,'supabase/migrations');
  for(const name of fs.readdirSync(migrationDir).sort().filter(f=>f.endsWith('.sql'))){await db.exec(fs.readFileSync(path.join(migrationDir,name),'utf8').replace(/create extension if not exists pgcrypto;/i,''));}
  await fixture();
  require.cache[appRequire.resolve('./backend/src/store')]={exports:store};
  const originalDraft=appRequire('./backend/src/report-draft');
  require.cache[appRequire.resolve('./backend/src/report-draft')]={exports:{...originalDraft,draftNarratives:async()=>({weekSummary:'Test draft',nextWeekPlan:'Test plan',source:'compiled'})}};
  const {createApp}=appRequire('./backend/src/app');
  server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
  const admin=await api('/auth/admin',null,'POST',{password:pw});assert.equal(admin.status,200);tokens.admin=admin.body.token;
  for(const [key,name,email]of [['pmo','Alice','alice@example.com'],['pmoOnly','PMO Only','pmo@example.com'],['participant','Bob','bob@example.com']]){
    const r=await api('/auth/participant',null,'POST',{companyId:'c1',name,email});assert.equal(r.status,200);tokens[key]=r.body.token;
    rows.push({name:'login_'+key,role:r.body.role,hasParticipantId:Boolean(r.body.participantId),pass:true});
  }
  for(const actor of [null,'admin','pmo','participant'])await check('dashboard_read_'+(actor||'guest'),actor==='admin'?200:actor?200:401,async()=>{
    const r=await api('/dashboard',actor);return {...r,...(actor&&actor!=='admin'&&r.body.companies?.some(c=>c.id==='c2')?{policyViolation:'Other company and personal report data returned'}:{}),evidence:{companies:r.body.companies?.map(c=>c.id),allParticipantIds:r.body.companies?.flatMap(c=>c.participants.map(p=>p.id)),otherCompanyTaskSummary:r.body.companies?.find(c=>c.id==='c2')?.participants[0]?.tasks[0]?.weeklySummary}};
  });
  await check('guest_cannot_write',401,()=>patch(null,taskUpdate('t1','name','Alice task','Edited')));
  for(const [actor,own,other]of [['admin','t1','t3'],['pmo','t1','t2'],['participant','t2','t1']]){
    for(const [scope,id]of [['own',own],['other',other]]){
      const allowed=actor==='admin'||scope==='own';
      await check(`${actor}_${scope}_task_update`,allowed?200:403,()=>patch(actor,taskUpdate(id,'weeklySummary','Original','Edited')));
      await check(`${actor}_${scope}_task_delete`,allowed?200:403,()=>patch(actor,{tasks:{deleted:[id]}}));
      await check(`${actor}_${scope}_weekly_create`,allowed?200:403,()=>patch(actor,{weeklyReports:{created:[{taskId:id,weekNumber:2,weeklySummary:'Test'}]}}));
      await check(`${actor}_${scope}_weekly_update`,allowed?200:403,async()=>{
        await db.query("insert into task_weekly_reports(id,task_id,week_number,weekly_summary)values($1,$2,2,'Original')",['w-'+id,id]);
        return patch(actor,{weeklyReports:{updated:[{taskId:id,weekNumber:2,sets:{weeklySummary:{base:'Original',value:'Edited'}}}]}});
      });
      await check(`${actor}_${scope}_weekly_delete`,allowed?200:403,async()=>{
        await db.query("insert into task_weekly_reports(id,task_id,week_number)values($1,$2,2)",['w-'+id,id]);
        return patch(actor,{weeklyReports:{deleted:[{taskId:id,weekNumber:2}]}});
      });
    }
    await check(`${actor}_own_task_create`,200,()=>patch(actor,{tasks:{created:[{id:'new-task',participantId:actor==='participant'?'p2':'p1',name:'New'}]}}));
  }
  for(const actor of ['admin','pmo','participant']){
    const allowHub=actor!=='participant';
    await check(`${actor}_hub_schedule`,actor==='admin'?200:403,()=>patch(actor,companyUpdate('c1',{schedule:{base:{startDate:'2026-10-01',kickoffDate:'',endDate:'2026-12-31'},value:{startDate:'2026-10-02',kickoffDate:'',endDate:'2026-12-31'}}})));
    await check(`${actor}_hub_pmo_members`,actor==='admin'?200:403,()=>patch(actor,{companies:{updated:[{id:'c1',pmoOps:{upsert:[{base:null,value:{name:'New PMO',email:'new@example.com'}}]}}]}}));
    await check(`${actor}_hub_notice_create`,allowHub?200:403,()=>patch(actor,{companies:{updated:[{id:'c1',noticeOps:{upsert:[{base:null,value:{id:'n2',title:'New'}}]}}]}}));
    await check(`${actor}_hub_notice_edit`,allowHub?200:403,()=>patch(actor,{companies:{updated:[{id:'c1',noticeOps:{upsert:[{base:{id:'n1',title:'Original',content:'Original'},value:{id:'n1',title:'Edited',content:'Original'}}]}}]}}));
    await check(`${actor}_hub_notice_delete`,allowHub?200:403,()=>patch(actor,{companies:{updated:[{id:'c1',noticeOps:{delete:[{id:'n1',base:{id:'n1',title:'Original',content:'Original'}}]}}]}}));
    await check(`${actor}_hub_participant_create`,allowHub?200:403,()=>patch(actor,{participants:{created:[{id:'p-new',companyId:'c1',name:'New',email:'new@example.com'}]}}));
    await check(`${actor}_hub_participant_update`,200,()=>patch(actor,{participants:{updated:[{id:'p2',sets:{dept:{base:'',value:'Updated'}}}]}}));
    await check(`${actor}_hub_participant_delete`,allowHub?200:403,()=>patch(actor,{participants:{deleted:['p2']}}));
    await check(`${actor}_company_delete`,actor==='admin'?200:403,()=>patch(actor,{companies:{deleted:['c1']}}));
  }
  await check('pmo_other_company_notice_blocked',403,()=>patch('pmo',{companies:{updated:[{id:'c2',noticeOps:{upsert:[{base:null,value:{id:'n3',title:'Other'}}]}}]}}));
  await check('participant_hub_ack_write_blocked',403,()=>patch('participant',companyUpdate('c1',{participantUpdateRequest:{base:{pending:false},value:{pending:true}}})));
  for(const actor of ['pmo','participant']){
    const ownId=actor==='pmo'?'p1':'p2';
    await check(`${actor}_created_task_existing_foreign_id_blocked`,[403,409],async()=>{
      const r=await patch(actor,{tasks:{created:[{id:'t3',participantId:ownId,name:'Overwritten by create'}]}});
      return {...r,evidence:(await db.query("select id,participant_id,name from tasks where id='t3'")).rows[0]};
    });
    await check(`${actor}_created_participant_existing_foreign_id_blocked`,[403,409],async()=>{
      const r=await patch(actor,{participants:{created:[{id:'p3',companyId:'c1',name:'Moved by create',email:'moved@example.com'}]}});
      return {...r,evidence:(await db.query("select id,company_id,name from participants where id='p3'")).rows[0]};
    });
  }
  await check('participant_only_own_profile_returned',200,async()=>{const r=await api('/dashboard','participant');assert.deepEqual(r.body.companies[0].participants.map(p=>p.id),['p2']);return r;});
  await check('participant_other_profile_edit_blocked',403,()=>patch('participant',{participants:{updated:[{id:'p1',sets:{dept:{base:'',value:'No'}}}]}}));
  await check('participant_own_company_move_blocked',403,()=>patch('participant',{participants:{updated:[{id:'p2',sets:{companyId:{base:'c1',value:'c2'}}}]}}));
  await check('participant_own_admin_field_blocked',403,()=>patch('participant',{participants:{updated:[{id:'p2',sets:{instructorMemo:{base:'',value:'No'}}}]}}));
  await check('participant_own_identity_edit_refreshes_session',200,async()=>{const r=await patch('participant',{participants:{updated:[{id:'p2',sets:{name:{base:'Bob',value:'Robert'},email:{base:'bob@example.com',value:'robert@example.com'}}}]}});assert.equal(r.status,200);assert.equal(r.body.session.email,'robert@example.com');const old=tokens.participant;tokens.participant=r.body.session.token;try{assert.equal((await api('/dashboard','participant')).status,200);}finally{tokens.participant=old;}return r;});
  await check('participant_successful_write_response_scope',200,async()=>{
    const r=await patch('participant',taskUpdate('t2','weeklySummary','Original','Edited'));
    return {...r,...(r.body.companies?.some(c=>c.id==='c2')?{policyViolation:'Write response returns other company and personal report data'}:{}),evidence:{returnedCompanies:r.body.companies?.map(c=>c.id)}};
  });
  await check('pmo_without_participant_gets_own_profile_on_login',200,async()=>{const r=await api('/auth/participant',null,'POST',{companyId:'c1',name:'PMO Only',email:'pmo@example.com'});assert(r.body.participantId);const found=(await db.query('select id from participants where email=$1',['pmo@example.com'])).rows;assert.equal(found.length,1);return r;});
  await check('guest_company_report_read_blocked',401,()=>api('/companies/c2/weekly-reports/1',null));
  await check('participant_other_company_report_read_blocked',403,()=>api('/companies/c2/weekly-reports/1','participant'));
  await check('pmo_other_company_report_read_blocked',403,()=>api('/companies/c2/weekly-reports/1','pmo'));
  await check('guest_company_narrative_blocked',401,()=>api('/companies/c2/weekly-reports/1/narrative',null,'POST',{}));
  await check('pmo_hub_report_draft_save',403,()=>api('/companies/c1/weekly-reports/1','pmo','PUT',{body:{weekSummary:'Test'}}));
  await fixture();
  const ui=uiAudit(await store.readData());
  const dbChecks=[];
  for(const role of ['anon','authenticated','service_role']){
    await db.exec('set role '+role);let read,write;
    try{read={allowed:true,count:(await db.query('select * from tasks')).rows.length};}catch(e){read={allowed:false,code:e.code};}
    try{await db.query('select apply_dashboard_changes($1::jsonb)',[JSON.stringify({tasks:{updated:[{id:'t3',sets:{name:{base:'Charlie task',value:'Service edit'}}}]}})]);write={allowed:true};}catch(e){write={allowed:false,code:e.code};}
    await db.exec('reset role');dbChecks.push({role,read,rpcWrite:write});
  }
  const results={environment:{database:'PGlite PostgreSQL; original migrations; original Express routes/access/session and row mappers; service_role adapter',productionSupabase:false,externalAiCalls:false},summary:{httpChecks:rows.filter(r=>'status'in r).length,httpPolicyMismatches:rows.filter(r=>r.pass===false).length},checks:rows,ui,dbChecks};
  assert.equal(rows.filter(r=>r.pass===false).length,0,JSON.stringify(rows.filter(r=>!r.pass)));
  assert.equal(ui.find(r=>r.name==='admin_other').reportSummaryReadonly,false);
  assert.equal(ui.find(r=>r.name==='pmo_colleague').taskSave,false);
  assert.equal(ui.find(r=>r.name==='participant_own').hubAddParticipant,false);
  for(const r of ui.filter(r=>r.name!=='pmo_personal_navigation'))assert.equal(r.hubOverview,false,r.name+' hub overview');
  const ownUi=ui.find(r=>r.name==='participant_own');assert.equal(ownUi.personalOverview,true);assert.equal(ownUi.personalOwnEdit,true);assert.equal(ownUi.personalPeerListed,false);assert.equal(ownUi.personalDelete,false);
  assert.equal(ui.find(r=>r.name==='pmo_colleague').personalPeerListed,true);
  console.log(JSON.stringify(results.summary));
  console.log('Policy mismatches:');for(const r of rows.filter(r=>r.pass===false))console.log(JSON.stringify(r));
  assert(dbChecks.find(r=>r.role==='anon').rpcWrite.allowed===false);
})().catch(e=>{console.error({message:e.message,code:e.code,stack:e.stack});process.exitCode=1}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await db.close();});
