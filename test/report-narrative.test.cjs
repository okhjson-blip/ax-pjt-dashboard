const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('both AI request modes ask for 3-4 lines centered on shared points and notable exceptions',async()=>{
 const requests=[],mod={exports:{}},expected={weekSummary:'공통 진행 사항입니다.\n주요 성과입니다.\n특이 사항입니다.',nextWeekPlan:'공통 계획입니다.\n우선 작업입니다.\n확인할 사항입니다.'};
 const ctx=vm.createContext({module:mod,require:()=>({envNonEmpty:name=>name==='GEMINI_API_KEY'}),process:{env:{GEMINI_API_KEY:'test-key'}},AbortSignal,console:{warn:()=>{}},fetch:async(_url,options)=>{requests.push(JSON.parse(options.body));return requests.length===1?{ok:false,status:400,text:async()=>''}:{ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(expected)}]}}]})};}});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../backend/src/report-draft.js'),'utf8'),ctx);
 const result=await mod.exports.draftNarratives('Test company',[{name:'Test task',weeklyProgress:'This week',nextPlan:'Next week'}]);assert.equal(result.source,'ai');assert.equal(result.weekSummary,expected.weekSummary);assert.equal(result.nextWeekPlan,expected.nextWeekPlan);assert.equal(requests.length,2);
 for(const request of requests){const input=JSON.parse(request.contents[0].parts[0].text),prompt=request.systemInstruction.parts[0].text+' '+input.instruction;assert.match(prompt,/3\s*~\s*4줄/);assert.match(prompt,/공통 인사이트/);assert.match(prompt,/특이/);assert.match(prompt,/줄바꿈/);assert.match(input.instruction,/thisWeek/);assert.match(input.instruction,/nextWeek/);}
});
function mockDraft(responses,{configured=true}={}){
 const calls=[],mod={exports:{}};
 const ctx=vm.createContext({module:mod,require:()=>({envNonEmpty:()=>configured}),process:{env:{GEMINI_API_KEY:'test-key'}},AbortSignal,console:{warn:()=>{}},fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));const value=responses[Math.min(calls.length-1,responses.length-1)];return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:typeof value==='string'?value:JSON.stringify(value)}]}}]})};}});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../backend/src/report-draft.js'),'utf8'),ctx);
 return {calls,run:()=>mod.exports.draftNarratives('Test company',[{name:'Task',weeklyProgress:'진행 사실',nextPlan:'계획 사실'}])};
}
const valid={weekSummary:'공통 진행 사항입니다.\n주요 성과입니다.\n특이 사항입니다.',nextWeekPlan:'공통 계획입니다.\n우선 작업입니다.\n확인할 사항입니다.'};
test('out-of-range AI line counts retry before accepting a valid draft',async()=>{const m=mockDraft([{weekSummary:'한 줄뿐',nextWeekPlan:valid.nextWeekPlan},valid]);const result=await m.run();assert.equal(m.calls.length,2);assert.equal(result.source,'ai');assert.equal(result.weekSummary,valid.weekSummary);});
test('five-line AI responses are not accepted as finished AI summaries',async()=>{const m=mockDraft([{weekSummary:'일\n이\n삼\n사\n오',nextWeekPlan:valid.nextWeekPlan}]);const result=await m.run();assert.equal(m.calls.length,2);assert.equal(result.source,'compiled');});
test('malformed AI JSON can retry with the alternate request mode',async()=>{const m=mockDraft(['invalid json',valid]);const result=await m.run();assert.equal(m.calls.length,2);assert.equal(result.source,'ai');});
test('missing configuration never sends an AI request',async()=>{const m=mockDraft([valid],{configured:false});const result=await m.run();assert.equal(m.calls.length,0);assert.equal(result.source,'compiled');});
