const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const weekly=require('../backend/src/weekly-report');
const now=new Date('2026-10-15T12:00:00+09:00');
class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now.getTime()]));}static now(){return now.getTime();}}
const ctx=vm.createContext({Date:FixedDate,console});
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/js/utils.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/js/report-document.js'),'utf8'),ctx);
function company(tasks){return {id:'c1',name:'Test company',schedule:{startDate:'2026-10-01',endDate:'2026-10-31'},participants:[{id:'p1',name:'Owner',tasks:tasks.map((t,i)=>({id:'t'+i,startDate:'2026-10-01',endDate:'2026-10-31',difficulty:'중',...t}))}]};}
for(const [name,tasks,expected]of [
 ['ahead of schedule',[{progress:90}],100],
 ['ahead cannot offset an unstarted task',[{progress:100},{progress:0}],50],
 ['difficulty does not affect achievement',[{progress:100,difficulty:'상'},{progress:0,difficulty:'하'}],50],
 ['behind schedule remains proportional',[{progress:24}],50],
 ['negative input is bounded',[{progress:-10}],0],
 ['before start keeps existing convention',[{progress:0,startDate:'2026-11-01',endDate:'2026-12-01'}],100]
])test('schedule achievement: '+name,()=>{const c=company(tasks);assert.equal(ctx.companyAchievementAvg(c),expected);assert.equal(weekly.companyOpsSummary(c,weekly.getConsultingWeek(c.schedule.startDate,now),now).scheduleGoalRate,expected);});
test('missing tasks and dates remain unmeasurable',()=>{assert.equal(ctx.companyAchievementAvg(company([])),null);const c=company([{progress:50}]);c.schedule={};c.participants[0].tasks[0].startDate='';c.participants[0].tasks[0].endDate='';assert.equal(ctx.companyAchievementAvg(c),null);});
test('report normalization and PDF rendering bound legacy rates',()=>{const c=company([{progress:90}]);const doc={weekNumber:3,body:{ops:{taskCount:1,participantCount:1,progress:90,scheduleGoalRate:220},taskRows:[]}};assert.equal(weekly.normalizeReportDoc(doc,c).body.ops.scheduleGoalRate,100);assert.equal(ctx.reportOpsView(doc).scheduleGoalRate,100);});
test('legacy target achievement helper also stays within 0-100',()=>{const c=company([{progress:90}]);assert.equal(ctx.targetAchievementRate(c,c.participants[0]),100);});
test('one task per participant yields the same task average',()=>{const c=company([{progress:90}]);c.participants.push({...company([{progress:24}]).participants[0],id:'p2'});assert.equal(ctx.companyAchievementAvg(c),75);assert.equal(weekly.companyOpsSummary(c,3,now).scheduleGoalRate,75);});
test('tasks without individual dates use the company schedule',()=>{const c=company([{progress:90,startDate:'',endDate:''}]);assert.equal(ctx.companyAchievementAvg(c),100);assert.equal(weekly.companyOpsSummary(c,3,now).scheduleGoalRate,100);});
test('past report snapshots also cap achievement',()=>{const c=company([{progress:0,weeklyReports:[{weekNumber:1,progress:80}]}]);assert.equal(weekly.companyOpsSummary(c,1,now).scheduleGoalRate,100);});

test('overall progress is a simple task average regardless of difficulty',()=>{const c=company([{progress:80,difficulty:'상'},{progress:40,difficulty:'하'}]);assert.equal(ctx.avgProgress(c.participants[0]),60);assert.equal(ctx.companyAvg(c),60);assert.equal(weekly.companyOpsSummary(c,3,now).progress,60);});
test('company averages all tasks equally without participant grouping or empty profiles',()=>{const c=company([{progress:100},{progress:100}]);c.participants.push({...company([{progress:0}]).participants[0],id:'p2'},{id:'p3',tasks:[]});assert.equal(ctx.companyAvg(c),67);assert.equal(ctx.companyAchievementAvg(c),67);const ops=weekly.companyOpsSummary(c,3,now);assert.equal(ops.progress,67);assert.equal(ops.scheduleGoalRate,67);assert.equal(ops.participantCount,3);});
test('expected progress also ignores task difficulty',()=>{const c=company([{progress:20,difficulty:'상'},{progress:20,difficulty:'하',endDate:'2026-10-10'}]);const expected=Math.round(c.participants[0].tasks.reduce((sum,t)=>sum+ctx.taskExpectedProgress(t,c),0)/2);assert.equal(ctx.expectedProgressAvg(c.participants[0],c),expected);});
