const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('both AI request modes ask for 3-4 lines centered on shared points and notable exceptions',async()=>{
 const requests=[],mod={exports:{}},expected={weekSummary:'공통 진행 사항입니다.\n주요 성과입니다.\n특이 사항입니다.',nextWeekPlan:'공통 계획입니다.\n우선 작업입니다.\n확인할 사항입니다.'};
 const ctx=vm.createContext({module:mod,require:()=>({envNonEmpty:name=>name==='GEMINI_API_KEY'}),process:{env:{GEMINI_API_KEY:'test-key'}},AbortSignal,console:{warn:()=>{}},fetch:async(_url,options)=>{requests.push(JSON.parse(options.body));return requests.length===1?{ok:false,status:400,text:async()=>''}:{ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(expected)}]}}]})};}});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../backend/src/report-draft.js'),'utf8'),ctx);
 const result=await mod.exports.draftNarratives('Test company',[{name:'Test task',weeklyProgress:'This week',nextPlan:'Next week'}]);assert.equal(result.source,'ai');assert.equal(result.weekSummary,expected.weekSummary);assert.equal(result.nextWeekPlan,expected.nextWeekPlan);assert.equal(requests.length,2);
 for(const request of requests){const input=JSON.parse(request.contents[0].parts[0].text),prompt=request.systemInstruction.parts[0].text+' '+input.instruction;assert.match(prompt,/3\s*~\s*4줄/);assert.match(prompt,/공통/);assert.match(prompt,/특이/);assert.match(prompt,/줄바꿈/);assert.match(input.instruction,/thisWeek/);assert.match(input.instruction,/nextWeek/);}
});
