// Fixed synthetic browser fixture; no database writes or user source images.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'vite';
const require=createRequire('C:/Users/XIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/playwright-test.cjs');
const {chromium}=require('playwright');
const deployed=process.env.MUSIC_FRONTEND_URL;if(deployed)assert.match(deployed,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const out=path.resolve(deployed?'.run/staff-rests-live':'.run/staff-rests'),dist=path.join(out,'dist');await mkdir(out,{recursive:true});
let server,browser,page;const report={checks:[],errors:[],blocked:[],databaseWrites:0};
try{
 if(!deployed){await build({configFile:path.resolve('vite.config.ts'),configLoader:'runner',build:{outDir:dist,emptyOutDir:false}});server=createServer(async(req,res)=>{try{const file=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert.ok(file===dist||file.startsWith(dist+path.sep));res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file===dist?path.join(dist,'index.html'):file));}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));}
 const base=deployed||`http://127.0.0.1:${server.address().port}`,id='synthetic-staff-rests',notes=[['before',60,'前'],['rest1',null,''],['rest2',null,''],['rest3',null,''],['after',67,'后']].map(([id,midi,lyric],i)=>({id,beat:i*4,duration:4,midi,lyric,phraseId:'p'}));
 const fixture={id,revision:1,title:'连续整小节休止固定验收',artist:'合成数据',album:'',composer:'',lyricist:'',description:'',tags:[],links:{bilibili:'',qq:'',netease:''},coverId:null,assets:[],archived:false,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',alignment:{offset:0,anchors:[]},score:{bpm:120,key:'C',timeSignature:[4,4],status:'reviewed',phrases:[{id:'p',label:'固定序列'}],notes}};
 const xml=`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1">${notes.map((note,i)=>`<measure number="${i+1}">${i===0?'<attributes><divisions>480</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>':''}<note>${note.midi===null?'<rest measure="yes"/>':`<pitch><step>${i===0?'C':'G'}</step><octave>4</octave></pitch>`}<duration>1920</duration><type>whole</type>${note.lyric?`<lyric><text>${note.lyric}</text></lyric>`:''}</note></measure>`).join('')}</part></score-partwise>`;
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1400,height:1000}});context.setDefaultTimeout(15000);page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base||request.method()!=='GET'){report.blocked.push(request.method()+' '+request.url());return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  let value,contentType='application/json';
  if(url.pathname==='/api/songs')value=[fixture];else if(url.pathname===`/api/songs/${id}`)value=fixture;
  else if(url.pathname===`/api/songs/${id}/export/musicxml`){value=xml;contentType='application/xml';}
  else if(url.pathname===`/api/songs/${id}/jobs`||url.pathname===`/api/songs/${id}/history`)value=[];
  else if(url.pathname==='/api/score-format')value={format:'shengjian.score',version:1,schema:{},template:{},prompt:'合成验收'};
  else if(url.pathname===`/api/songs/${id}/external-prompt`)value={format:'shengjian.score',version:1,prompt:'合成验收',manifest:[]};
  else{report.blocked.push(request.method()+' '+url.pathname);return route.abort();}
  return route.fulfill({contentType,body:typeof value==='string'?value:JSON.stringify(value)});
 });
 await page.goto(base);await page.getByRole('button',{name:'打开歌曲 '+fixture.title,exact:true}).click();await page.getByRole('button',{name:'五线谱',exact:true}).click();
 await page.waitForFunction(()=>{const pane=document.querySelector('.staff-viewport');return pane&&!pane.textContent.includes('正在排版五线谱');});
 const failure=await page.locator('.staff-viewport .notice').allTextContents();assert.deepEqual(failure,[],'consecutive whole-bar rests must render instead of falling back');
 const staff=page.locator('.staff-score');assert.ok(await staff.locator('svg path').count()>0);
 for(const [i,note]of notes.entries()){
  assert.ok(await staff.locator(`[data-staff-note-id="${note.id}"]`).count()>0,`rest/next note ${note.id} keeps its own graphical event`);
  await page.getByLabel('播放位置（拍）',{exact:true}).fill(String(i*4+.25));
  await page.waitForFunction(id=>document.querySelector('.staff-score')?.getAttribute('data-active-note-id')===id,note.id);
 }
 report.checks.push('three consecutive whole-bar rests render separately, each keeps its exact playback position, and the following pitched note highlights at beat16');
 await page.getByLabel('谱面字号',{exact:true}).fill('16');await page.waitForFunction(()=>document.querySelector('.staff-score')?.getAttribute('data-zoom')==='0.5');assert.ok(await staff.locator('[data-staff-note-id="rest2"]').count()>0);assert.deepEqual(await page.locator('.staff-viewport .notice').allTextContents(),[]);
 report.checks.push('font scaling retains rest and note bindings');await page.screenshot({path:path.join(out,'consecutive-rests.png'),fullPage:true});assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);throw error;}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify(report,null,2));}
