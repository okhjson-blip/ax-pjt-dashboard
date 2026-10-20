const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=fs.existsSync(path.join(__dirname,'../backend'))?path.resolve(__dirname,'..'):path.resolve(__dirname,'../ax-pjt-dashboard-main');
const {createRequire}=require('node:module');const req=createRequire(path.join(root,'package.json'));
const {normalizeChanges,applyChangesToNested}=req('./backend/src/store-changes');
test('failed create can retry without adding a second draft task',async()=>{
 const data={companies:[{id:'c1',name:'Company',participants:[{id:'p1',name:'Owner',email:'owner@example.com',tasks:[]}]}]};
 const calls=[],listeners={},elements={app:{innerHTML:''},toast:{appendChild:()=>{}},'task-name':{value:'Retry task'}};
 const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 const API={setToken:()=>{},getDashboard:async()=>structuredClone(data),saveDashboardChanges:async changes=>{calls.push(structuredClone(changes));if(calls.length===1)throw Object.assign(new Error('Temporary network failure'),{status:503});return applyChangesToNested(structuredClone(data),normalizeChanges(changes));}};
 const ctx=vm.createContext({console,API,Date,Math,setTimeout:()=>0,clearTimeout:()=>{},sessionStorage:storage,localStorage:storage,window:{confirm:()=>true,alert:()=>{}},document:{getElementById:id=>elements[id]||null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({remove:()=>{}}),addEventListener:(n,fn)=>listeners[n]=fn}});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/js/task-access.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'public/js/utils.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'public/js/app.js'),'utf8').replace(/  bootstrap\(\);\s*\}\)\(\);\s*$/,'globalThis.audit={state,applyDashboardData};})();'),ctx);
 ctx.audit.applyDashboardData(structuredClone(data));Object.assign(ctx.audit.state,{loading:false,auth:{role:'participant',companyId:'c1',participantId:'p1',email:'owner@example.com'},view:'personal',selectedCompanyId:'c1',selectedParticipantId:'p1',modal:'addTask',form:{companyId:'c1',participantId:'p1'}});
 const click=()=>listeners.click({target:{closest:s=>s==='[data-action]'?{dataset:{action:'add-task'}}:null}});
 await click();assert.equal(ctx.audit.state.modal,'addTask');await click();assert.equal(calls.length,2);assert.equal(calls[1].tasks.created.length,1);assert.equal(calls[0].tasks.created[0].id,calls[1].tasks.created[0].id);assert.equal(ctx.audit.state.modal,null);
});
for(const kind of ['participant','notice'])test('failed '+kind+' creation reuses the draft on retry',async()=>{
 const data={companies:[{id:'c1',name:'Company',pmo:{members:[]},notices:[],participants:[{id:'p1',name:'Owner',email:'owner@example.com',tasks:[]}]}]};
 const calls=[],listeners={},elements={app:{innerHTML:''},toast:{appendChild:()=>{}},'new-name':{value:'New user'},'new-email':{value:'new@example.com'},'new-dept':{value:'Team'},'notice-title':{value:'Notice'},'notice-content':{value:'Body'}};
 const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 const API={setToken:()=>{},getDashboard:async()=>structuredClone(data),saveDashboardChanges:async changes=>{calls.push(structuredClone(changes));if(calls.length===1)throw Object.assign(new Error('Temporary failure'),{status:503});return applyChangesToNested(structuredClone(data),normalizeChanges(changes));}};
 const ctx=vm.createContext({console,API,Date,Math,setTimeout:()=>0,clearTimeout:()=>{},sessionStorage:storage,localStorage:storage,window:{confirm:()=>true,alert:()=>{}},document:{getElementById:id=>elements[id]||null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({remove:()=>{}}),addEventListener:(n,fn)=>listeners[n]=fn}});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/js/task-access.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(root,'public/js/utils.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(root,'public/js/app.js'),'utf8').replace(/  bootstrap\(\);\s*\}\)\(\);\s*$/,'globalThis.audit={state,applyDashboardData};})();'),ctx);
 ctx.audit.applyDashboardData(structuredClone(data));Object.assign(ctx.audit.state,{loading:false,auth:{role:'admin'},view:'company',selectedCompanyId:'c1',modal:kind==='participant'?'addParticipant':'addNotice',form:{companyId:'c1'}});
 const click=()=>listeners.click({target:{closest:s=>s==='[data-action]'?{dataset:{action:kind==='participant'?'add-participant':'save-notice'}}:null}});await click();await click();
 const count=changes=>kind==='participant'?changes.participants.created.length:changes.companies.updated[0].noticeOps.upsert.length;
 assert.equal(count(calls[0]),1);assert.equal(count(calls[1]),1);assert.equal(ctx.audit.state.modal,null);
});
