// Fixed browser-only API fixture. Never reads user scores, GT or the live database.
// This catches per-character wrapping, overlapping lyric columns, lost LF rows,
// horizontal page overflow, and changes to note seeking / inclusive A-B selection.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'vite';
const require=createRequire('C:/Users/XIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/playwright-test.cjs');
const {chromium}=require('playwright');
const deployed=process.env.MUSIC_FRONTEND_URL;if(deployed)assert.match(deployed,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const out=path.resolve(deployed?'.run/lyrics-layout-v6-live':'.run/lyrics-layout-v6'),dist=path.join(out,'dist');await mkdir(out,{recursive:true});
const words=['not','some-','one','remember','unforgettable','bright ','future',"don't",'re-','turn','你','好','one two','ly','','end'];
const notes=words.map((lyric,i)=>({id:`dense-${i}`,beat:i/4,duration:.25,midi:60+i%7,lyric:`${lyric}\n${i===0?'不可':i===4?'难以忘怀':i===14?'下行':'字'}`,phraseId:'p1'}));
notes.push(...['清','风','\nonly second','中英mixed','short\n短音','天\nsky','留 白\nkeep  spaces','夜\nnight'].map((lyric,i)=>({id:`mixed-${i}`,beat:4+i/2,duration:.5,midi:65+i%4,lyric,phraseId:'p2'})));
const fixture={id:'synthetic-lyrics-v6',revision:1,title:'英文歌词固定排版验收',artist:'合成数据',album:'',composer:'',lyricist:'',description:'',tags:[],links:{bilibili:'',qq:'',netease:''},coverId:null,assets:[],archived:false,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',alignment:{offset:0,anchors:[]},score:{bpm:60,key:'C',timeSignature:[4,4],status:'reviewed',phrases:[{id:'p1',label:'密集英文'},{id:'p2',label:'双行混排'}],notes}};
const report={checks:[],matrix:[],followLayout:[],errors:[],blocked:[],databaseWrites:0};let server,browser,page;
async function activeBounds(label){return page.evaluate(label=>{const pane=document.querySelector('.score-card .notation-viewport'),note=pane.querySelector('.score-note.active'),outer=pane.getBoundingClientRect(),inner=note.getBoundingClientRect();return {label,noteId:note.dataset.noteId,scrollLeft:pane.scrollLeft,paneLeft:outer.left,paneRight:outer.right,noteLeft:inner.left,noteRight:inner.right,visible:inner.left>=outer.left&&inner.right<=outer.right};},label);}
async function checkSameNoteFollowing(label){
 try{await page.waitForFunction(()=>{const pane=document.querySelector('.score-card .notation-viewport'),note=pane.querySelector('.score-note.active'),outer=pane.getBoundingClientRect(),inner=note.getBoundingClientRect();return inner.left>=outer.left&&inner.right<=outer.right;},{},{timeout:2500});}catch(error){if(error.name!=='TimeoutError')throw error;}
 report.followLayout.push(await activeBounds(label));
}
try{
 if(!deployed){
  await build({configFile:path.resolve('vite.config.ts'),configLoader:'runner',build:{outDir:dist,emptyOutDir:false}});
  server=createServer(async(req,res)=>{try{const target=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert.ok(target===dist||target.startsWith(dist+path.sep));const file=target===dist?path.join(dist,'index.html'):target;res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.mp3')?'audio/mpeg':'text/html');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 }
 const base=deployed||`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(15000);page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base||request.method()!=='GET'){report.blocked.push(request.method()+' '+request.url());return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  let value;
  if(url.pathname==='/api/songs')value=[fixture];
  else if(url.pathname===`/api/songs/${fixture.id}`)value=fixture;
  else if(url.pathname===`/api/songs/${fixture.id}/jobs`||url.pathname===`/api/songs/${fixture.id}/history`)value=[];
  else if(url.pathname==='/api/score-format')value={format:'shengjian.score',version:1,schema:{},template:{},prompt:'合成验收'};
  else if(url.pathname===`/api/songs/${fixture.id}/external-prompt`)value={format:'shengjian.score',version:1,prompt:'合成验收',manifest:[]};
  else{report.blocked.push(request.method()+' '+url.pathname);return route.abort();}
  return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.goto(base);await page.getByRole('button',{name:'打开歌曲 '+fixture.title,exact:true}).click();
 await page.locator('.score-card .paper-numbered-score [data-note-id="dense-0"]').waitFor();
 for(const width of [1440,390])for(const size of [16,32,52]){
  await page.setViewportSize({width,height:1000});await page.getByLabel('谱面字号',{exact:true}).fill(String(size));await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(({notes,width,size})=>{
   const violations=[],pane=document.querySelector('.notation-viewport'),sheet=pane.querySelector('.paper-numbered-score');
   const boxes=[];
   for(const note of notes){
    const cell=sheet.querySelector(`[data-note-id="${note.id}"]`),cellBox=cell.getBoundingClientRect(),rows=[...cell.querySelectorAll('.lyric-line')],expected=note.lyric.split('\n');
    if(rows.length!==2)violations.push(`${note.id}: expected two aligned rows, got ${rows.length}`);
    rows.forEach((row,index)=>{
     const wanted=expected[index]||'\u00a0';if(row.textContent!==wanted)violations.push(`${note.id}/${index+1}: text changed`);
     const range=document.createRange();range.selectNodeContents(row);const rects=[...range.getClientRects()],rect=range.getBoundingClientRect();
     const tops=[...new Set(rects.map(box=>Math.round(box.top*10)/10))];
     if(tops.length>1)violations.push(`${note.id}/${index+1}: fragment wraps onto ${tops.length} visual lines`);
     if(rect.left<cellBox.left-.5||rect.right>cellBox.right+.5)violations.push(`${note.id}/${index+1}: text extends beyond its note column`);
     boxes.push({id:note.id,row:index+1,text:row.textContent,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,lines:tops.length,columnWidth:cellBox.width,textWidth:rect.width});
    });
   }
   for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];if(a.id===b.id||!a.text.trim()||!b.text.trim())continue;
    if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5)violations.push(`${a.id}/${a.row} overlaps ${b.id}/${b.row}`);
   }
   if(document.documentElement.scrollWidth>width+1)violations.push(`page overflows ${document.documentElement.scrollWidth-width}px`);
   return {width,size,viewportWidth:pane.clientWidth,viewportScrollWidth:pane.scrollWidth,pageWidth:document.documentElement.scrollWidth,boxes,violations};
  },{notes,width,size});
  report.matrix.push(result);
  if(width===390&&size===52||width===1440&&size===32)await page.screenshot({path:path.join(out,`lyrics-${width}-${size}.png`),fullPage:true});
 }
 assert.deepEqual(report.matrix.flatMap(result=>result.violations.map(message=>`${result.width}px/${result.size}: ${message}`)),[],'each stored lyric fragment must occupy one unbroken line within a separate column');
 assert.ok(report.matrix.filter(result=>result.width===390).every(result=>result.viewportScrollWidth>result.viewportWidth),'dense measures must scroll inside the notation viewport');
 report.checks.push('24 fixed English words/syllables, Chinese and mixed fragments retain exact spaces and LF rows; bounding boxes show no wrapping, overlap or page overflow at 1440/390px × 16/32/52');
 await page.getByLabel('播放位置（拍）',{exact:true}).fill('3.8');
 await page.waitForFunction(()=>document.querySelector('.score-card [data-note-id="dense-15"]')?.classList.contains('active'));
 await page.waitForFunction(()=>{const pane=document.querySelector('.score-card .notation-viewport'),note=pane.querySelector('[data-note-id="dense-15"]'),outer=pane.getBoundingClientRect(),inner=note.getBoundingClientRect();return pane.scrollLeft>0&&inner.left>=outer.left&&inner.right<=outer.right;},{},{timeout:2500});
 await page.getByLabel('播放位置（拍）',{exact:true}).fill('0.1');
 await page.waitForFunction(()=>{const pane=document.querySelector('.score-card .notation-viewport'),note=pane.querySelector('[data-note-id="dense-0"]'),outer=pane.getBoundingClientRect(),inner=note.getBoundingClientRect();return inner.left>=outer.left&&inner.right<=outer.right;},{},{timeout:2500});
 report.checks.push('automatic playback follow scrolls horizontally to a late dense-measure note and back to its first note');
 // The active beat stays fixed throughout each layout change. An onset-only
 // effect would leave the widened or newly clipped note outside the pane.
 await page.getByLabel('谱面字号',{exact:true}).fill('16');await page.getByLabel('播放位置（拍）',{exact:true}).fill('3.8');await checkSameNoteFollowing('before-font-change');
 await page.getByLabel('谱面字号',{exact:true}).fill('52');await checkSameNoteFollowing('font-16-to-52');
 await page.setViewportSize({width:1440,height:1000});await page.getByLabel('播放位置（拍）',{exact:true}).fill('0.1');await checkSameNoteFollowing('reset-before-viewport-resize');await page.getByLabel('播放位置（拍）',{exact:true}).fill('3.8');await checkSameNoteFollowing('before-viewport-resize');
 await page.setViewportSize({width:390,height:1000});await checkSameNoteFollowing('viewport-1440-to-390');
 await page.setViewportSize({width:1440,height:1000});await page.getByLabel('播放位置（拍）',{exact:true}).fill('0.1');await checkSameNoteFollowing('reset-before-pane-resize');await page.getByLabel('播放位置（拍）',{exact:true}).fill('3.8');await checkSameNoteFollowing('before-pane-resize');
 await page.locator('.score-card .notation-viewport').evaluate(pane=>pane.style.width='350px');await checkSameNoteFollowing('pane-only-resize-to-350');
 await page.locator('.score-card .notation-viewport').evaluate(pane=>pane.style.removeProperty('width'));
 assert.deepEqual(report.followLayout.filter(result=>!result.visible),[],'font or pane-size changes must keep the same active note visible without waiting for another onset');
 assert.ok(report.followLayout.filter(result=>!result.label.startsWith('reset-')).every(result=>result.noteId==='dense-15'),'layout changes must not seek or change the active note');
 report.checks.push('same active note stays visible after 16-to-52 font change, 1440-to-390 viewport resize and independent pane resize');
 await page.setViewportSize({width:390,height:1000});await page.getByLabel('谱面字号',{exact:true}).fill('16');await page.getByLabel('跟随播放',{exact:true}).uncheck();
 await page.locator('.score-card .notation-viewport').evaluate(pane=>pane.scrollTo({left:0,behavior:'instant'}));
 await page.getByLabel('谱面字号',{exact:true}).fill('52');await page.locator('.score-card .notation-viewport').evaluate(pane=>pane.style.width='250px');
 const withoutFollowing=await page.evaluate(async()=>{const pane=document.querySelector('.score-card .notation-viewport'),positions=[];for(let i=0;i<15;i++){await new Promise(resolve=>requestAnimationFrame(resolve));positions.push(pane.scrollLeft);}return positions;});
 assert.ok(withoutFollowing.every(left=>left===0),'disabled following must not scroll for font or pane-size changes');
 assert.equal((await activeBounds('follow-disabled')).noteId,'dense-15');assert.equal(Number(await page.getByLabel('播放位置（拍）',{exact:true}).inputValue()),3.8);
 await page.locator('.score-card .notation-viewport').evaluate(pane=>pane.style.removeProperty('width'));await page.getByLabel('跟随播放',{exact:true}).check();
 report.checks.push('follow disabled preserves manual horizontal position and the exact active beat during font and pane-size changes');
 await page.setViewportSize({width:1440,height:1000});await page.getByLabel('谱面字号',{exact:true}).fill('32');
 await page.getByRole('button',{name:'选循环',exact:true}).click();await page.locator('.score-card .paper-numbered-score [data-note-id="dense-3"]').click();await page.locator('.score-card .paper-numbered-score [data-note-id="dense-7"]').click();
 assert.equal(await page.getByLabel('A 拍',{exact:true}).inputValue(),'0.75');assert.equal(await page.getByLabel('B 拍',{exact:true}).inputValue(),'2');
 assert.equal(await page.locator('.score-card .paper-numbered-score .in-loop').count(),5);await page.getByRole('button',{name:'清除循环',exact:true}).click();
 await page.getByLabel('播放位置（拍）',{exact:true}).fill('6.2');await page.waitForFunction(()=>document.querySelector('.paper-numbered-score [data-note-id="mixed-4"]')?.classList.contains('active'));
 await page.getByLabel('点击音符提前拍数',{exact:true}).fill('0.5');await page.locator('.score-card .paper-numbered-score [data-note-id="mixed-0"]').click();
 await page.waitForFunction(()=>document.querySelector('.transport-status')?.textContent==='播放中');await page.locator('.transport-main [aria-label="暂停"]').click();
 const position=Number(await page.getByLabel('播放位置（拍）',{exact:true}).inputValue());assert.ok(position>=3.5&&position<4.5,`clicking beat4 with 0.5 pre-roll should seek to 3.5, got ${position}`);
 report.checks.push('exact beat seek/highlight, note click pre-roll and inclusive last-note A/B timing remain intact');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);throw error;}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify({...report,matrix:report.matrix.map(({boxes,...summary})=>summary)},null,2));}
