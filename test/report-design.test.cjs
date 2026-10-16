const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const weekly = require('../backend/src/weekly-report');
const now = new Date('2026-10-16T12:00:00+09:00');
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now.getTime()])); } }
function context() {
  const ctx = vm.createContext({Date: FixedDate});
  for (const file of ['utils.js', 'report-document.js']) vm.runInContext(fs.readFileSync(`${__dirname}/../public/js/${file}`, 'utf8'), ctx);
  return ctx;
}
function doc(rows) {
  return {title:'회사 <주간보고>',weekNumber:3,periodEnd:'2026-10-16',source:{companyName:'회사',companySchedule:{startDate:'2026-10-01',endDate:'2026-10-31'}},body:{ops:{taskCount:rows.length},taskRows:rows}};
}
// Catches using the reference HTML's deadline/70% rules instead of hub thresholds.
test('report uses hub status thresholds and company schedule fallback', () => {
  const ctx=context();
  const report=doc([]);
  for (const [progress,label] of [[52,'양호'],[37,'정상'],[36,'정체']]) {
    assert.equal(ctx.reportTaskStatus({progress},report).label,label);
  }
  assert.equal(ctx.reportTaskStatus({progress:0}, {...report,source:{}}).label,'일정미설정');
  assert.equal(ctx.reportTaskStatus({progress:0,periodStart:'2026-11-01',periodEnd:'2026-11-30'},report).label,'양호');
});
test('past reports use report period rather than today', () => {
  const ctx=context(), report=doc([]);
  report.periodEnd='2026-10-10';
  assert.equal(ctx.reportTaskStatus({progress:20},report).label,'정상');
});
test('report renders actual data safely and limits watchlist to stalled tasks', () => {
  const ctx=context(), report=doc([{name:'<script>bad</script>',progress:0,weeklyProgress:'작업\n두 번째 줄',nextPlan:'계획'},{name:'순조로운 과제',progress:100}]);
  const html=ctx.renderWeeklyReportPdfHtml(report);
  assert(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert(!html.includes('<script>'));
  assert(html.includes('작업<br>두 번째 줄'));
  const watch=html.slice(html.indexOf('data-report-section="watchlist"'),html.indexOf('data-report-section="details"'));
  assert(watch.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert(!watch.includes('순조로운 과제'));
  assert(html.includes('일정미설정') || html.includes('정체'));
});
test('report source keeps schedule fallback after save and legacy load', () => {
  const company={id:'c',name:'회사',schedule:{startDate:'2026-10-01',endDate:'2026-10-31'},participants:[]};
  const assembled=weekly.assembleCompanyWeeklyReport(company,3,now);
  assert.deepEqual(assembled.source.companySchedule,company.schedule);
  const legacy=weekly.normalizeReportDoc({weekNumber:3,body:{}},company);
  assert.deepEqual(legacy.source.companySchedule,company.schedule);
  const saved=weekly.normalizeReportDoc(assembled,{...company,schedule:{}});
  assert.deepEqual(saved.source.companySchedule,company.schedule);
});

test('automatic report titles include AX tasks without replacing custom or published titles', () => {
  const company={id:'c',name:'에이스테크놀로지',schedule:{startDate:'2026-09-16'},participants:[]};
  assert.equal(weekly.emptyReportDoc(company,5).title,'에이스테크놀로지 AX 과제 주간보고 (5주차)');
  const old={weekNumber:5,title:'에이스테크놀로지 주간보고 (5주차)',body:{}};
  assert.equal(weekly.normalizeReportDoc(old,company).title,'에이스테크놀로지 AX 과제 주간보고 (5주차)');
  assert.equal(weekly.normalizeReportDoc({...old,title:'별도 제목'},company).title,'별도 제목');
  assert.equal(weekly.normalizeReportDoc({...old,status:'published'},company).title,old.title);
});

test('watchlist includes start and end dates and details use only status bullets', () => {
  const ctx=context(),report=doc([{name:'상태 점 표시 과제',progress:0,periodStart:'2026-09-01',periodEnd:'2026-10-01'}]);
  const html=ctx.renderWeeklyReportPdfHtml(report);
  const watch=html.slice(html.indexOf('data-report-section="watchlist"'),html.indexOf('data-report-section="details"'));
  assert(watch.includes('<th>시작일</th><th>종료일</th>'));
  assert(!watch.includes('<th>사유</th>'));
  assert(watch.includes('2026-09-01'));
  const details=html.slice(html.indexOf('data-report-section="details"'));
  assert(details.includes('pdf-task-title'));
  assert(details.includes('pdf-dot pdf-red'));
  assert(!details.includes('pdf-chip'));
  assert(!html.includes('pdf-page-header'));
  assert(!html.includes('협력사 주간 제출자료'));
  assert(html.includes('pdf-page-number'));
});
