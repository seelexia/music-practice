// Real local API, isolated fresh frontend, synthetic self-owned songs only.
// No source samples, model calls, settings writes, restarts or permanent deletion.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'vite';
const require=createRequire('C:/Users/XIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/playwright-test.cjs');
const {chromium}=require('playwright');
const live=process.env.MUSIC_URL||'http://127.0.0.1:3210';assert.match(live,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const deployed=process.env.MUSIC_FRONTEND_URL;if(deployed)assert.match(deployed,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const out=path.resolve(deployed?'.run/practice-library-v5-live':'.run/practice-library-v5');await mkdir(out,{recursive:true});
const checks=[],errors=[],blocked=[],writes=[],owned=new Set(),fixtures=[];let browser,page,failure;
async function api(route,body,method=body===undefined?'GET':'POST'){
 const response=await fetch(live+'/api'+route,{method,headers:{'X-Music-Client':'web','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const value=await response.json();assert.equal(response.status,200,`${route}: ${JSON.stringify(value)}`);return value;
}
const dist=path.join(out,'dist');if(!deployed)await build({configFile:path.resolve('vite.config.ts'),configLoader:'runner',build:{outDir:dist,emptyOutDir:false}});
const server=createServer(async(req,res)=>{try{const target=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert.ok(target===dist||target.startsWith(dist+path.sep));const file=target===dist?path.join(dist,'index.html'):target;res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=deployed||`http://127.0.0.1:${server.address().port}`;
let holdPatch=false,releasePatch;
const wav=Buffer.alloc(44+44100*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
async function viewportHeight(selector){const box=await page.locator(selector).boundingBox();assert.ok(box,selector);assert.ok(Math.abs(box.height-(page.viewportSize().height-100))<=3,`${selector} ${box.height} should start at viewport -100`);}
async function selectAll(){await page.getByRole('button',{name:/^全选当前结果/}).click();}
async function batchDone(count){await page.getByText(`已完成 ${count} 首。`,{exact:true}).waitFor();}
async function overview(archive=false){await page.locator('.sidebar').getByRole('button',{name:archive?'归档歌曲':'我的曲库',exact:true}).click();await page.getByRole('heading',{name:archive?'归档歌曲':'我的曲库',exact:true}).waitFor();}
async function manage(){await page.getByRole('button',{name:'批量管理',exact:true}).click();}
async function read(id){return api('/songs/'+id);}
async function pitchControls(){
 const canvas=page.locator('canvas.pitch-canvas');await canvas.waitFor();const readRange=()=>canvas.evaluate(el=>[Number(el.dataset.rangeLow),Number(el.dataset.rangeHigh)]);
 const first=await readRange();await page.getByRole('button',{name:'音域上移',exact:true}).click();const second=await readRange();assert.deepEqual(second,[first[0]+6,first[1]+6]);
 await page.getByRole('button',{name:'音域下移',exact:true}).click();assert.deepEqual(await readRange(),first);
 await page.getByLabel('显示半音',{exact:true}).uncheck();assert.ok((await canvas.getAttribute('data-grid-notes')).split(',').map(Number).every(m=>[0,2,4,5,7,9,11].includes(m%12)));
 await page.getByLabel('显示半音',{exact:true}).check();assert.ok((await canvas.getAttribute('data-grid-notes')).split(',').map(Number).some(m=>m%12===1));
 const rect=await canvas.boundingBox();await page.mouse.move(rect.x+rect.width*.6,rect.y+rect.height*.37);await page.mouse.wheel(0,-120);await page.waitForFunction(previous=>{const el=document.querySelector('canvas.pitch-canvas');return Number(el.dataset.rangeHigh)-Number(el.dataset.rangeLow)<previous[1]-previous[0];},first);
 const zoomed=await readRange();await page.getByRole('button',{name:'音域上移',exact:true}).click();const panned=await readRange();assert.ok(Math.abs((panned[1]-panned[0])-(zoomed[1]-zoomed[0]))<1e-8);assert.ok(Math.abs(panned[0]-zoomed[0]-6)<1e-8);
 assert.equal(await page.getByRole('button',{name:/全屏音高|全屏练习区|谱面全屏/}).count(),0);
}
try{
 const stamp=Date.now();
 const score={bpm:120,key:'C',timeSignature:[4,4],status:'corrected',phrases:[{id:'p',label:'合成测试'}],notes:[{id:'tie',beat:1,duration:5,midi:60,lyric:'长',phraseId:'p'},{id:'rest',beat:6,duration:1,midi:null,lyric:'',phraseId:'p'},{id:'next',beat:8,duration:1,midi:64,lyric:'音',phraseId:'p'},{id:'end',beat:9,duration:1,midi:67,lyric:'终',phraseId:'p'}]};
 for(const [name,tags,archived] of [['甲',['练习','原标签'],false],['乙',['练习'],false],['丙',['保留'],false],['丁',['旧藏'],true]]){
  let song=await api('/songs',{title:`v5验收${name}-${stamp}`,artist:'自动化夹具'});owned.add(song.id);song=await api('/songs/'+song.id,{revision:song.revision,tags,archived,score},'PATCH');fixtures.push(song);
 }
 const [a,b,c,d]=fixtures;
 const upload=await fetch(`${live}/api/songs/${a.id}/assets?kind=recording`,{method:'POST',headers:{'X-Music-Client':'web','Content-Type':'audio/wav','X-File-Name':encodeURIComponent('v5-synthetic.wav')},body:wav});assert.equal(upload.status,200);const withTake=await upload.json();const take=withTake.assets.at(-1);
 const historyBefore=await api(`/songs/${a.id}/history`);
 const tone=Buffer.alloc(44+44100*4*2);wav.copy(tone,0,0,44);tone.writeUInt32LE(tone.length-8,4);tone.writeUInt32LE(tone.length-44,40);const hz=440*2**((61.3-69)/12);for(let i=0;i<(tone.length-44)/2;i++)tone.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*hz*i/44100)),44+i*2);const tonePath=path.join(out,'synthetic-microphone.wav');await writeFile(tonePath,tone);
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+tonePath]});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['microphone']});context.setDefaultTimeout(20000);page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  if(/\/(recognize|lyrics\/align|settings|providers)(\/|$)/.test(url.pathname)){blocked.push(method+' '+url.pathname);return route.abort();}
  const songId=/^\/api\/(?:songs|trash)\/([^/]+)/.exec(url.pathname)?.[1];
  if(songId&&!owned.has(songId)){blocked.push(method+' '+url.pathname);return route.abort();}
  if(method!=='GET'&&!songId){blocked.push(method+' '+url.pathname);return route.abort();}
  if(method!=='GET')writes.push({method,path:url.pathname,body:request.postDataJSON()});
  if(holdPatch&&method==='PATCH'){holdPatch=false;await new Promise(resolve=>{releasePatch=resolve;});}
  const response=await fetch(live+url.pathname+url.search,{method,headers:{'X-Music-Client':'web','Content-Type':'application/json'},body:request.postDataBuffer()??undefined});let bytes=Buffer.from(await response.arrayBuffer());
  if(method==='GET'&&(url.pathname==='/api/songs'||url.pathname==='/api/trash'))bytes=Buffer.from(JSON.stringify(JSON.parse(bytes.toString()).filter(song=>owned.has(song.id))));
  await route.fulfill({status:response.status,headers:{'Content-Type':response.headers.get('Content-Type')||'application/json'},body:bytes});
 });
 await page.route('**/assets/**',async route=>{const url=new URL(route.request().url());assert.equal(url.pathname,take.url);const response=await fetch(live+url.pathname);await route.fulfill({status:response.status,contentType:response.headers.get('Content-Type')||'audio/wav',body:Buffer.from(await response.arrayBuffer())});});
 await page.goto(base);await page.getByRole('heading',{name:'我的曲库',exact:true}).waitFor();await manage();await page.getByRole('button',{name:'筛选标签 练习',exact:true}).click();await selectAll();await page.getByText('已选择 2 首',{exact:true}).waitFor();
 await page.getByLabel('总览关键词搜索',{exact:true}).fill('甲');await page.getByText('已选择 0 首',{exact:true}).waitFor();await page.getByLabel('总览关键词搜索',{exact:true}).fill('');await selectAll();
 await page.getByLabel('批量标签',{exact:true}).fill('新标签，练习');await page.getByRole('button',{name:'添加标签',exact:true}).click();await batchDone(2);assert.deepEqual((await read(a.id)).tags,['练习','原标签','新标签']);assert.deepEqual((await read(b.id)).tags,['练习','新标签']);assert.deepEqual((await read(c.id)).tags,['保留']);
 checks.push('batch select-all respects tag/query filters; changing filters clears selection; tag additions preserve unrelated tags and unselected songs');
 await selectAll();await page.getByLabel('批量标签',{exact:true}).fill('新标签');await page.getByRole('button',{name:'移除标签',exact:true}).click();await batchDone(2);assert.deepEqual((await read(a.id)).tags,['练习','原标签']);
 await selectAll();const stale=await read(a.id);await api('/songs/'+a.id,{revision:stale.revision,description:'另一页面刚保存的内容'},'PATCH');await page.getByRole('button',{name:'批量归档',exact:true}).click();await page.getByText('已完成 1 首；1 首未完成，仍保留选中。',{exact:false}).waitFor();assert.equal((await read(a.id)).archived,false);assert.equal((await read(b.id)).archived,true);await page.getByText('已选择 1 首',{exact:true}).waitFor();
 await page.getByRole('button',{name:'重新读取未完成歌曲',exact:true}).click();await page.getByText('已重新读取 1 首歌曲，请核对后重试所需操作。',{exact:true}).waitFor();await page.getByRole('button',{name:'批量归档',exact:true}).click();await batchDone(1);assert.equal((await read(a.id)).description,'另一页面刚保存的内容');
 checks.push('a stale selected revision fails visibly while other songs complete; explicit re-read/retry preserves the concurrent edit');
 await overview(true);await manage();await page.getByLabel(`选择歌曲 ${a.title}`,{exact:true}).check();await page.getByLabel(`选择歌曲 ${b.title}`,{exact:true}).check();await page.getByRole('button',{name:'批量移入回收站',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();assert.equal((await read(a.id)).deletedAt,undefined);
 await page.getByRole('button',{name:'批量移入回收站',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByText(a.title,{exact:true}).waitFor();await dialog.getByText(b.title,{exact:true}).waitFor();await dialog.getByRole('button',{name:'确认移入回收站',exact:true}).click();await batchDone(2);const trash=await api('/trash');assert.ok(trash.some(song=>song.id===a.id)&&trash.some(song=>song.id===b.id));assert.equal((await read(d.id)).archived,true);
 await page.locator('.library-trash summary').click();await page.getByRole('button',{name:`恢复已删除歌曲 ${a.title}`,exact:true}).click();await page.getByLabel(`选择歌曲 ${a.title}`,{exact:true}).waitFor();await page.getByRole('button',{name:`恢复已删除歌曲 ${b.title}`,exact:true}).click();await page.getByLabel(`选择歌曲 ${b.title}`,{exact:true}).waitFor();
 assert.deepEqual(await api(`/songs/${a.id}/history`),historyBefore);assert.deepEqual(Buffer.from(await (await fetch(live+take.url)).arrayBuffer()),wav);
 await page.getByLabel(`选择歌曲 ${a.title}`,{exact:true}).check();await page.getByLabel(`选择歌曲 ${b.title}`,{exact:true}).check();holdPatch=true;await page.getByRole('button',{name:'批量恢复原分类',exact:true}).click();await page.getByText('正在处理 0 / 2 首，请稍候…',{exact:true}).waitFor();await page.locator('.sidebar').getByRole('button',{name:'我的曲库',exact:true}).click();await page.getByText('批量操作正在进行，请等待完成后再切换页面。',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'归档歌曲',exact:true}).count(),1);releasePatch();await batchDone(2);await overview();
 checks.push('archived batch delete previews exact songs, cancel is inert, recycle restore retains recording bytes/history; bulk restore blocks navigation until finished');
 await page.getByRole('button',{name:`打开歌曲 ${a.title}`,exact:true}).click();await page.getByRole('button',{name:'五线谱',exact:true}).click();const staff=page.locator('.staff-score');await staff.locator('svg').first().waitFor();await viewportHeight('.score-practice-only');
 const size=page.getByLabel('谱面字号',{exact:true});assert.equal(await size.getAttribute('min'),'16');const defaultGlyph=await staff.locator('[data-staff-note-id="tie"]').first().boundingBox();
 await size.fill('16');await page.waitForFunction(height=>document.querySelector('.staff-score [data-staff-note-id="tie"]')?.getBoundingClientRect().height<height*.75,defaultGlyph.height);
 assert.equal(await staff.getAttribute('data-zoom'),'0.5');const smallGlyph=await staff.locator('[data-staff-note-id="tie"]').first().boundingBox();assert.ok(smallGlyph.height<defaultGlyph.height*.75);
 await size.fill('40');assert.equal(await staff.getAttribute('data-zoom'),'1.25');
 const seek=page.getByLabel('播放位置（拍）',{exact:true});await seek.fill('4.5');await page.waitForFunction(()=>document.querySelector('.staff-score')?.getAttribute('data-active-note-id')==='tie');assert.ok(await staff.locator('.staff-note-active[data-staff-note-id="tie"]').count()>=2);
 const highlightedColor=await staff.locator('.staff-note-active path').first().evaluate(el=>getComputedStyle(el).fill);assert.equal(highlightedColor,'rgb(192, 120, 0)');await seek.fill('7.5');await page.waitForFunction(()=>!document.querySelector('.staff-score .staff-note-active'));await seek.fill('8.2');await page.waitForFunction(()=>document.querySelector('.staff-score')?.getAttribute('data-active-note-id')==='next');
 await page.getByRole('button',{name:'回到开头',exact:true}).click();await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.staff-score')?.getAttribute('data-active-note-id')==='tie');await page.getByRole('button',{name:'暂停',exact:true}).click();
 const nextGlyph=staff.locator('[data-staff-note-id="next"]').first();await nextGlyph.click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor();await page.getByRole('button',{name:'暂停',exact:true}).click();const at=Number(await seek.inputValue());assert.ok(at>=7&&at<9,`click exact note with one beat lead-in: ${at}`);
 const follow=page.getByLabel('跟随播放',{exact:true});await follow.uncheck();await page.locator('.staff-viewport').evaluate(el=>{el.style.width='320px';el.style.height='100px';el.style.flex='none';});await seek.fill('8.2');await page.waitForFunction(()=>document.querySelector('.staff-score .staff-note-active[data-staff-note-id="next"]'));await page.locator('.staff-viewport').evaluate(el=>el.scrollTo({top:0,behavior:'instant'}));await follow.check();await page.waitForFunction(()=>document.querySelector('.staff-viewport').scrollTop>0);await page.locator('.staff-viewport').evaluate(el=>el.removeAttribute('style'));await page.waitForFunction(()=>document.querySelector('.staff-score .staff-note-active[data-staff-note-id="next"]'));
 checks.push('staff responds to font size16/40, colors tied fragments/lyrics during playback, clears in gaps and seeks, and glyph clicks retain exact-note lead-in');
 assert.equal(await page.getByRole('button',{name:/全屏音高|全屏练习区|谱面全屏/}).count(),0);await page.getByRole('button',{name:'页面全屏',exact:true}).click();assert.equal(await page.evaluate(()=>document.fullscreenElement),null);assert.ok(await page.locator('.practice-panel').evaluate(el=>el.getBoundingClientRect().height===innerHeight));await page.keyboard.press('Escape');await page.getByRole('button',{name:'页面全屏',exact:true}).waitFor();
 const handle=page.getByRole('separator',{name:'调整谱面区域高度',exact:true});await handle.focus();await handle.press('ArrowDown');assert.ok(Math.abs((await page.locator('.score-practice-only').boundingBox()).height-924)<=2);await handle.press('Enter');await viewportHeight('.score-practice-only');
 await page.getByRole('button',{name:'谱面 + 音高',exact:true}).click();await viewportHeight('.score-monitor-split');await pitchControls();await page.getByRole('button',{name:'页面全屏',exact:true}).click();await page.screenshot({path:path.join(out,'split-fullpage.png')});await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'音高',exact:true}).click();await viewportHeight('.score-monitor-split.monitor-only>.monitor-card');await pitchControls();
 await page.getByRole('button',{name:'录音',exact:true}).click();await page.getByRole('button',{name:'人声',exact:true}).click();await viewportHeight('.score-monitor-split.monitor-only>.monitor-card');await pitchControls();
 checks.push('practice/split/song-pitch/recording replay start at viewport height; browser-internal fullscreen only; keyboard resize/reset works; pitch controls work in every song context');
 await page.locator('.sidebar').getByRole('button',{name:'独立音高',exact:true}).click();await viewportHeight('.standalone-pitch>.monitor-card');await pitchControls();await page.getByRole('button',{name:'启用麦克风',exact:true}).click();await page.getByRole('button',{name:'关闭麦克风',exact:true}).waitFor();await page.waitForFunction(()=>Number(document.querySelector('canvas.pitch-canvas')?.getAttribute('data-note-box-count'))>0);await page.getByLabel('显示半音',{exact:true}).uncheck();assert.ok(Number(await page.locator('canvas.pitch-canvas').getAttribute('data-note-box-count'))>0);assert.equal(await page.locator('.pitch-readout>strong').textContent(),'C♯4');await page.getByRole('button',{name:'关闭麦克风',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await viewportHeight('.standalone-pitch>.monitor-card');await page.getByRole('button',{name:'页面全屏',exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:path.join(out,'pitch-mobile.png')});await page.keyboard.press('Escape');
 await page.locator('.mobile-actions').getByRole('button',{name:'我的曲库',exact:true}).click();await manage();await selectAll();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));for(const label of ['添加标签','移除标签']){const bounds=await page.getByRole('button',{name:label,exact:true}).boundingBox();assert.ok(bounds.width>=90&&bounds.height<=45,`${label} stays horizontal on mobile`);}await page.screenshot({path:path.join(out,'batch-mobile.png'),fullPage:true});
 checks.push('standalone microphone retains note detection/boxes with natural grid; 390px pitch/fullpage and batch controls fit without horizontal overflow');
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.ok(writes.every(write=>owned.has(/^\/api\/(?:songs|trash)\/([^/]+)/.exec(write.path)?.[1])));checks.push('no runtime errors, foreign-song writes, model/settings requests or service restart');
}catch(error){failure=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
 releasePatch?.();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
 for(const fixture of fixtures){try{const trash=await api('/trash');const deleted=trash.find(song=>song.id===fixture.id);if(deleted)await api('/trash/'+fixture.id+'/restore',{revision:deleted.revision});const current=await read(fixture.id);if(!current.archived)await api('/songs/'+fixture.id,{revision:current.revision,archived:true},'PATCH');}catch(error){failure=(failure?failure+'; ':'')+'cleanup: '+String(error);}}
 const report={base,passed:checks.length,checks,errors,blocked,writes,ownedIds:[...owned],failed:!!failure,failure};await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
