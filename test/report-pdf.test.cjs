const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('PDF export keeps table rows and text blocks together and waits for fonts',async()=>{
 let options,removed=false,fontsReady=false;
 const element={style:{}},wrapper={style:{},querySelector:()=>element,remove:()=>{removed=true;}};
 const ctx=vm.createContext({escapeHtml:s=>s,document:{createElement:()=>wrapper,body:{appendChild:()=>{}},fonts:{ready:Promise.resolve().then(()=>{fontsReady=true;})}},html2pdf:()=>{assert(fontsReady);return {set:value=>{options=value;return {from:source=>{assert.equal(source,element);return {save:async()=>{}};}};}};}});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/js/report-document.js'),'utf8'),ctx);
 await ctx.downloadWeeklyReportPdf({weekNumber:1,body:{taskRows:[]}},'test.pdf');
 assert(options.pagebreak?.mode.includes('css'));for(const selector of ['tr','p','li'])assert(options.pagebreak.avoid.includes(selector),selector);
 assert.equal(element.style.width,'186mm');assert(removed);
});
