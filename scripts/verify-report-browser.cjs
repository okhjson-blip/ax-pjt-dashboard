// Run with Playwright available through NODE_PATH. No server or credentials needed.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const output = process.argv[2];
  if (!output) throw new Error('Pass an output directory for the sample PDF and screenshot.');
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:950,height:1150},ignoreHTTPSErrors:true});
    await page.setContent('<div class="report-pdf-preview"></div>');
    await page.addStyleTag({content:await fs.readFile(path.join(__dirname,'../public/css/styles.css'),'utf8')});
    for (const file of ['utils.js','report-document.js']) await page.addScriptTag({content:await fs.readFile(path.join(__dirname,'../public/js',file),'utf8')});
    const report = {
      title:'협력사 AX 과제 주간보고 (5주차)', weekNumber:5, periodStart:'2026-10-14',periodEnd:'2026-10-20',status:'published',publishedAt:'2026-10-16T12:00:00+09:00',
      source:{companyName:'협력사 디자인 검증',companySchedule:{startDate:'2026-09-01',endDate:'2026-11-30'}},
      body:{ops:{taskCount:30,participantCount:17,progress:42,scheduleGoalRate:65},weekSummary:'데이터 수집 및 프로그램 초기 버전 구현이 진행되었습니다.\n\n- 과제별 진행 상황과 일정 목표를 점검했습니다.\n- 부서별 데이터 정합성 검토를 진행했습니다.',nextWeekPlan:'장비 연결 검증 및 대시보드 개선을 진행합니다.',taskRows:Array.from({length:30},(_,i)=>({name:`과제 ${i+1}: 측정 데이터 수집 및 업무 자동화 시스템 구축`,ownerName:`담당자 ${i+1}`,dept:'기술개발팀',periodStart:'2026-09-01',periodEnd:'2026-11-30',progress:(i*17)%101,weeklyProgress:'수집 프로그램 초기 버전을 구현하고 사용자 의견을 반영했습니다.\n데이터 정합성과 주요 기능을 확인했습니다.',nextPlan:'실제 장비 연결 및 모델별 호환성 확인, 사용자 매뉴얼 보완을 진행합니다.'}))}
    };
    async function layout(doc) {
      return page.evaluate(async doc => {
        const preview=document.querySelector('.report-pdf-preview');
        preview.innerHTML=renderWeeklyReportPdfHtml(doc);
        await refreshWeeklyReportPreview();
        const pages=[...preview.querySelectorAll('.pdf-page')];
        return {pages:pages.length,overflow:pages.map(p=>{const b=p.querySelector('.pdf-page-body');return b.scrollHeight-b.clientHeight;}),text:pages.map(p=>p.querySelector('.pdf-page-body').textContent).join(''),detailText:[...preview.querySelectorAll('.pdf-details tbody tr')].map(tr=>tr.cells[2]?.textContent || '').join(''),tablePages:pages.filter(p=>p.querySelector('tbody')).map(p=>!!p.querySelector('thead')),numbers:pages.map(p=>p.querySelector('.pdf-page-number').textContent),watchRowsOnFirst:pages[0].querySelectorAll('.pdf-watchlist tbody tr').length,watchRowsTotal:preview.querySelectorAll('.pdf-watchlist tbody tr').length,detailStartPage:pages.findIndex(p=>p.querySelector('[data-report-section="details"]')),headerCount:preview.querySelectorAll('.pdf-top,.pdf-page-foot').length,detailChips:preview.querySelectorAll('.pdf-details .pdf-chip').length};
      },doc);
    }
    let result=await layout(report);
    assert(result.pages>2);
    assert(result.overflow.every(n=>n<=0.5),JSON.stringify(result.overflow));
    assert(result.tablePages.every(Boolean));
    for (const row of report.body.taskRows) assert(result.text.includes(row.name),row.name);
    assert.equal(result.numbers.at(-1),`${result.pages} / ${result.pages}`);
    assert.equal(result.watchRowsOnFirst,result.watchRowsTotal,'Sections 01–03 should fit on the first page for a typical report');
    assert.equal(result.detailStartPage,1);
    assert.equal(result.headerCount,0);
    assert.equal(result.detailChips,0);
    const wrapping=await page.evaluate(()=>{
      let wrapped=0,misaligned=0,splitWords=0;
      for (const title of document.querySelectorAll('.pdf-task-title')) {
        const node=title.querySelector('b').firstChild;
        if (node?.nodeType!==Node.TEXT_NODE) continue;
        const range=document.createRange(),lines=new Map();
        for(let i=0;i<node.length;i++) {
          if (/\s/.test(node.textContent[i])) continue;
          range.setStart(node,i);range.setEnd(node,i+1);
          const rect=range.getBoundingClientRect();
          if (!lines.has(rect.top)) lines.set(rect.top,rect.left);
        }
        if(lines.size>1) {
          wrapped++;
          if(Math.max(...lines.values())-Math.min(...lines.values())>1) misaligned++;
        }
        for(const match of node.textContent.matchAll(/[가-힣]+/gu)) {
          range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
          if(range.getClientRects().length>1) splitWords++;
        }
      }
      return {wrapped,misaligned,splitWords};
    });
    assert(wrapping.wrapped>0);
    assert.equal(wrapping.misaligned,0);
    assert.equal(wrapping.splitWords,0);
    console.log('30 tasks:',result.pages,'pages; summary fits first page; table headers and page numbers present; Korean words and hanging indents verified');
    await page.locator('.report-pdf-preview').evaluate(el=>{el.style.maxHeight='none';});
    await page.locator('.pdf-page').first().screenshot({path:path.join(output,'report-design-preview.png')});
    await page.locator('.pdf-page').nth(1).screenshot({path:path.join(output,'report-design-page2.png')});

    const huge=structuredClone(report);
    huge.body.taskRows=[{...huge.body.taskRows[0],weeklyProgress:'긴내용검증 '.repeat(2200)+'마지막내용확인'}];
    huge.body.weekSummary='요약검증 '.repeat(2000)+'요약마지막확인';
    result=await layout(huge);
    const longPageCount=result.pages;
    assert(result.overflow.every(n=>n<=0.5),JSON.stringify(result.overflow));
    assert(result.text.includes('마지막내용확인'));
    assert(result.text.includes('요약마지막확인'));
    assert.equal(result.detailText,huge.body.taskRows[0].weeklyProgress);
    console.log('Oversized row and summary:',result.pages,'pages; all text retained without overflow');
    const empty=structuredClone(report);empty.body.taskRows=[];
    result=await layout(empty);
    assert(result.overflow.every(n=>n<=0.5));
    assert(result.text.includes('등록된 과제가 없습니다.'));
    console.log('Empty report: no overflow');

    await layout(report);
    await page.addScriptTag({url:'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js'});
    const pdf=await page.evaluate(async doc=>{
      let data;
      window.html2pdf.Worker.prototype.save=function(){return this.get('pdf').then(pdf=>{data={pages:pdf.internal.getNumberOfPages(),uri:pdf.output('datauristring')};});};
      await downloadWeeklyReportPdf(doc,'report-design-preview.pdf');
      return {...data,wrappers:document.querySelectorAll('body > div[style*="-9999px"]').length};
    },report);
    assert.equal(pdf.pages,await page.locator('.pdf-page').count());
    assert.equal(pdf.wrappers,0);
    const bytes=Buffer.from(pdf.uri.split(',')[1],'base64');
    assert(bytes.subarray(0,4).equals(Buffer.from('%PDF')));
    await fs.writeFile(path.join(output,'report-design-preview.pdf'),bytes);
    console.log('Actual html2pdf export:',pdf.pages,'A4 pages;',bytes.length,'bytes; wrapper cleaned up');
    const longPdf=await page.evaluate(async doc=>{
      let result;
      window.html2pdf.Worker.prototype.save=function(){return this.get('pdf').then(pdf=>{
        const images=Object.values(pdf.internal.collections.addImage_images || {});
        result={pages:pdf.internal.getNumberOfPages(),images:images.map(image=>({width:image.width,height:image.height,bytes:image.data.length}))};
      });};
      await downloadWeeklyReportPdf(doc,'long-report.pdf');
      return result;
    },huge);
    assert.equal(longPdf.pages,longPageCount);
    assert.equal(longPdf.images.length,longPdf.pages);
    assert(longPdf.images.every(image=>image.height<3000 && image.bytes>1000),JSON.stringify(longPdf.images));
    console.log('Long report export:',longPdf.pages,'pages; every page has a bounded, nonempty image');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
