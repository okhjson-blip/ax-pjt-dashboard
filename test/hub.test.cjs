const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {scopeDashboard}=require('../backend/src/access');
const actor={role:'participant',companyId:'c1',participantId:'p1',name:'Owner',email:'own@example.com'};
const fixture=()=>({companies:[{id:'c1',name:'Own company',schedule:{startDate:'2026-10-01',endDate:'2026-12-31'},pmo:{members:[{name:'PMO',email:'pmo@example.com'}]},notices:[{id:'n1',title:'Company notice',content:'Notice body'}],participants:[{id:'p1',name:'Owner',email:'own@example.com',dept:'One',tasks:[{id:'t1',name:'Own task',progress:20,weeklySummary:'Own report'}]},{id:'p2',name:'Peer',email:'peer@example.com',dept:'Two',instructorMemo:'Private memo',tasks:[{id:'t2',name:'Peer task',progress:70,difficulty:'상',startDate:'2026-10-01',endDate:'2026-12-31',reportCompleted:true,instructorFeedback:'Private feedback',weeklySummary:'Private report',members:[{email:'private@example.com'}]}]}]},{id:'c2',name:'Other company',participants:[]}]});
test('participant hub includes full company summaries while personal data stays own-only',()=>{
 const scoped=scopeDashboard(actor,fixture());assert.deepEqual(scoped.companies[0].participants.map(p=>p.id),['p1']);
 assert.deepEqual(scoped.hubCompanies.map(c=>c.id),['c1']);const hub=scoped.hubCompanies[0];assert.equal(hub.notices[0].content,'Notice body');assert.equal(hub.pmo.members.length,1);assert.equal(hub.participants.length,2);
 const peer=hub.participants.find(p=>p.id==='p2');assert.equal(peer.instructorMemo,undefined);assert.equal(peer.tasks[0].progress,70);assert.equal(peer.tasks[0].hasInstructorFeedback,true);
 for(const key of ['weeklySummary','weeklyDetail','weeklyIssues','nextWeekPlan','instructorFeedback','members','weeklyReports'])assert.equal(peer.tasks[0][key],undefined,key);
});
function ui(){
 const listeners={},elements={app:{innerHTML:''},toast:{appendChild:()=>{}}},storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 const ctx=vm.createContext({console,Date,setTimeout:()=>0,clearTimeout:()=>{},API:{setToken:()=>{}},localStorage:storage,sessionStorage:storage,window:{alert:()=>{},confirm:()=>true},document:{getElementById:id=>elements[id]||null,addEventListener:(n,fn)=>listeners[n]=fn,querySelector:()=>null,querySelectorAll:()=>[]}});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/js/task-access.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/js/utils.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/js/app.js'),'utf8').replace(/  bootstrap\(\);\s*\}\)\(\);\s*$/,'globalThis.audit={state,applyDashboardData,renderCompanyHub,renderPersonalDashboard};})();'),ctx);
 const a=ctx.audit;a.applyDashboardData(scopeDashboard(actor,fixture()));Object.assign(a.state,{loading:false,auth:actor,view:'company',selectedCompanyId:'c1',selectedParticipantId:'p1'});
 return {a,ctx,click:dataset=>listeners.click({target:{closest:s=>s==='[data-action]'?{dataset}:null}})};
}
test('hub shows peer progress but only own detail navigates to the personal dashboard',async()=>{
 const {a,click}=ui();const html=a.renderCompanyHub();assert(html.includes('Peer task'));assert(html.includes('Company notice'));assert(html.includes('70%'));assert(html.includes('강사 피드백 작성'));
 assert(html.includes('data-action="view-person" data-company="c1" data-participant="p1"'));assert(!html.includes('data-action="view-person" data-company="c1" data-participant="p2"'));
 await click({action:'view-person',company:'c1',participant:'p2',task:'t2'});assert.equal(a.state.view,'company');
 await click({action:'view-person',company:'c1',participant:'p1',task:'t1'});assert.equal(a.state.view,'personal');assert.equal(a.state.selectedParticipantId,'p1');assert.equal(a.state.selectedTaskId,'t1');assert(!a.renderPersonalDashboard().includes('Peer task'));
});
test('viewing hub summaries cannot add peer changes to a personal save',()=>{
 const {a,ctx}=ui();a.renderCompanyHub();a.state.companies[0].participants[0].tasks[0].name='Edited own task';const changes=vm.runInContext('buildDashboardChanges(audit.state.baseline,audit.state.companies)',ctx);assert.deepEqual(Array.from(changes.tasks.updated,t=>t.id),['t1']);
});
