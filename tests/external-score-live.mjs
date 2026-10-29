import {externalTranscriptionExample} from '../web/external-prompt.ts';
// Real local-service round trip, using only a self-created song, image and package.
// Does not change providers/settings, call a VLM, or read existing song materials.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire('C:/Users/XIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/playwright-test.cjs');
const {chromium}=require('playwright');
const base=process.env.MUSIC_URL||'http://127.0.0.1:3210';
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base),'This fixture test only runs against a local service');
const out=path.resolve('.run/external-score-v4-live');await mkdir(out,{recursive:true});
const checks=[],runtimeErrors=[],unexpectedModelCalls=[],writes=[];
let fixture,browser,page,failure,archived=false,packageValue,appliedRevision;
async function request(route,body,method=body===undefined?'GET':'POST',expected=200,headers={}){
 const response=await fetch(base+'/api'+route,{method,headers:{'X-Music-Client':'web','Content-Type':'application/json',...headers},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
 const value=await response.json();assert.equal(response.status,expected,`${method} ${route}: ${JSON.stringify(value)}`);return value;
}
async function openFixture(){
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'打开歌曲 '+fixture.title,exact:true}).click();
 await page.getByRole('button',{name:'识谱',exact:true}).click();
 await page.getByRole('heading',{name:'外部转谱导入',exact:true}).waitFor();
}
function midiEvents(buffer){
 assert.equal(buffer.toString('ascii',0,4),'MThd');assert.equal(buffer.readUInt32BE(4),6);
 assert.equal(buffer.readUInt16BE(8),0);assert.equal(buffer.readUInt16BE(10),1);assert.equal(buffer.readUInt16BE(12),480);
 assert.equal(buffer.toString('ascii',14,18),'MTrk');assert.equal(buffer.readUInt32BE(18),buffer.length-22);
 let offset=22,tick=0;const events=[];
 function vlq(){let result=0;for(let i=0;i<4;i++){const byte=buffer[offset++];assert.ok(byte!==undefined,'MIDI event is in bounds');result=(result<<7)|(byte&127);if(!(byte&128))return result;}throw Error('Invalid MIDI VLQ');}
 while(offset<buffer.length){tick+=vlq();const status=buffer[offset++];
  if(status===255){offset++;const length=vlq();offset+=length;}
  else if((status&240)===192||(status&240)===208)offset++;
  else{const pitch=buffer[offset++],velocity=buffer[offset++];if((status&240)===128||(status&240)===144)events.push([tick,status,pitch,velocity]);}
 }
 return events;
}
try{
 assert.equal((await request('/health')).ok,true);
 const format=await request('/score-format');assert.equal(format.format,'shengjian.score');assert.equal(format.version,1);assert.equal(format.schema.$schema,'https://json-schema.org/draft/2020-12/schema');
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1440,height:1050}});context.setDefaultTimeout(15000);
 // Capture the exact UI clipboard payload without modifying the user's system clipboard.
 await context.addInitScript(()=>{window.__externalPromptCopy='';Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__externalPromptCopy=value;}}});});
 page=await context.newPage();page.on('pageerror',error=>runtimeErrors.push(error.message));
 page.on('request',req=>{if(req.url().includes('/api/songs/')&&req.method()!=='GET')writes.push({method:req.method(),path:new URL(req.url()).pathname,body:req.postDataJSON()});});
 await page.route('**/api/songs/**/recognize',route=>{unexpectedModelCalls.push(route.request().url());return route.abort();});
 await page.route('**/api/songs/**/lyrics/align',route=>{unexpectedModelCalls.push(route.request().url());return route.abort();});
 fixture=await request('/songs',{title:'外部转谱合成验收 '+Date.now(),artist:'Synthetic fixture'});
 const baselineScore={bpm:80,key:'C',timeSignature:[4,4],status:'corrected',phrases:[{id:'baseline-p',label:'保留旧版'}],notes:[{id:'baseline-n',beat:0,duration:1,midi:60,lyric:'旧',phraseId:'baseline-p',uncertain:false}]};
 const metadata={artist:'Synthetic fixture',album:'Preserved album',composer:'Preserved composer',lyricist:'Preserved lyricist',description:'Metadata must survive external import',tags:['internal-test','external-import-v4'],links:{bilibili:'',qq:'',netease:''},lyricsText:'保留手动歌词'};
 fixture=await request('/songs/'+fixture.id,{revision:fixture.revision,score:baselineScore,...metadata},'PATCH');
 await page.setContent('<canvas width="640" height="220"></canvas>');
 const pngData=await page.locator('canvas').evaluate(canvas=>{const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,640,220);ctx.fillStyle='#142019';ctx.font='22px sans-serif';ctx.fillText('Synthetic fixture: D major, 4/4, 120 BPM',24,40);ctx.font='44px serif';ctx.fillText('1    2    0    5 —',40,122);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(39,130);ctx.lineTo(67,130);ctx.moveTo(124,130);ctx.lineTo(154,130);ctx.stroke();return canvas.toDataURL('image/png').split(',')[1];});
 const sourceBytes=Buffer.from(pngData,'base64');await writeFile(path.join(out,'synthetic-score.png'),sourceBytes);
 fixture=await request(`/songs/${fixture.id}/assets?kind=score`,sourceBytes,'POST',200,{'Content-Type':'image/png','X-File-Name':'synthetic-score.png'});
 const source=fixture.assets.find(asset=>asset.kind==='score'),baseRevision=fixture.revision;
 const prompt=await request(`/songs/${fixture.id}/external-prompt`);assert.equal(prompt.format,format.format);assert.equal(prompt.version,format.version);assert.deepEqual(prompt.manifest,[{id:'page-1',name:'synthetic-score.png',assetId:source.id}]);assert.match(prompt.prompt,/synthetic-score\.png/);assert.match(prompt.prompt,/shengjian\.score/);assert.doesNotMatch(prompt.prompt,/[A-Z]:\\|file:\/\//);
 packageValue={...structuredClone(format.template),metadata:{title:'Package title must not rename song',key:'D',bpm:120,timeSignature:[4,4]},sources:[{id:'page-1',name:'synthetic-score.png'}],phrases:[{id:'roundtrip-p',label:'合成片段'}],measures:[{id:'roundtrip-m',sourceId:'page-1',row:1,notes:[
  {id:'roundtrip-1',degree:1,octave:0,duration:[1,2],lyric:'合',phraseId:'roundtrip-p',rhythm:{underlines:1,dots:0,extensions:0}},
  {id:'roundtrip-2',degree:2,octave:1,duration:[1,2],lyric:'成',phraseId:'roundtrip-p',rhythm:{underlines:1,dots:0,extensions:0}},
  {id:'roundtrip-rest',degree:0,octave:0,duration:[1,1],lyric:'',phraseId:'roundtrip-p',rhythm:{underlines:0,dots:0,extensions:0}},
  {id:'roundtrip-4',degree:5,octave:-1,duration:[2,1],lyric:'谱',phraseId:'roundtrip-p',rhythm:{underlines:0,dots:0,extensions:1}}
 ]}],warnings:['Synthetic package warning: compare the original image'],provenance:{producer:'self-created live browser fixture'}};
 const packageText=JSON.stringify(packageValue,null,2);await writeFile(path.join(out,'synthetic-package.json'),packageText);
 await openFixture();await page.getByRole('button',{name:'复制本曲转谱提示词',exact:true}).click();const copiedPrompt=await page.evaluate(()=>window.__externalPromptCopy);assert.ok(copiedPrompt.startsWith(prompt.prompt));assert.match(copiedPrompt,/score\.shengjian\.score\.json/);checks.push('actual contextual endpoint manifest and one-click UI copy agree');
 for(const [label,expected] of [['下载格式规范',format.schema],['下载示例模板',externalTranscriptionExample(format.template)]]){const event=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const download=await event;assert.deepEqual(JSON.parse(await readFile(await download.path(),'utf8')),expected);}checks.push('live schema and template buttons download the published contract');
 await page.getByLabel('导入外部转谱 JSON 文件',{exact:true}).setInputFiles(path.join(out,'synthetic-package.json'));
 await page.waitForFunction(text=>document.querySelector('[aria-label="外部转谱 JSON"]').value===text,packageText);
 const importing=page.waitForResponse(response=>response.url().endsWith(`/api/songs/${fixture.id}/import-score`)&&response.request().method()==='POST');
 await page.getByRole('button',{name:'校验并创建审核草稿',exact:true}).click();const importedResponse=await importing;assert.equal(importedResponse.status(),200);const job=await importedResponse.json();
 assert.equal(job.mode,'external');assert.equal(job.status,'review');assert.equal(job.baseRevision,baseRevision);assert.deepEqual(job.sourcePackage,packageValue);assert.deepEqual(job.sourceMapping,{'page-1':source.id});assert.ok(job.warnings.some(text=>text.includes('Synthetic package warning')));
 const expectedNotes=[[0,.5,62],[.5,.5,76],[1,1,null],[2,2,57]];assert.deepEqual(job.draft.notes.map(note=>[note.beat,note.duration,note.midi]),expectedNotes);
 assert.deepEqual(job.draft.notes.map(note=>note.durationFraction),[[1,2],[1,2],[1,1],[2,1]]);assert.ok(job.draft.notes.every(note=>note.sourcePage===source.id));
 let current=await request('/songs/'+fixture.id);assert.equal(current.revision,baseRevision);assert.deepEqual(current.score,baselineScore);assert.equal(current.lyricsText,metadata.lyricsText);
 const apply=page.getByRole('button',{name:'确认应用草稿',exact:true});await apply.waitFor();assert.equal(await apply.isDisabled(),true);assert.equal(writes.some(write=>write.path.endsWith('/apply')),false);await page.screenshot({path:path.join(out,'review.png'),fullPage:true});checks.push('real file import creates only a retained review job; original revision, score and manual lyrics stay untouched');
 const applying=page.waitForResponse(response=>response.url().endsWith(`/jobs/${job.id}/apply`)&&response.request().method()==='POST');await page.getByRole('checkbox',{name:/我已审阅草稿/}).check();await apply.click();const appliedResponse=await applying;assert.equal(appliedResponse.status(),200);current=await appliedResponse.json();appliedRevision=current.revision;
 assert.equal(appliedRevision,baseRevision+1);assert.equal(current.title,fixture.title);for(const [key,value] of Object.entries(metadata))assert.deepEqual(current[key],value,`metadata ${key}`);assert.equal(current.score.key,'D');assert.equal(current.score.bpm,120);assert.deepEqual(current.score.notes.map(note=>[note.beat,note.duration,note.midi]),expectedNotes);
 const appliedJob=(await request(`/songs/${fixture.id}/jobs`)).find(value=>value.id===job.id);assert.equal(appliedJob.status,'applied');assert.deepEqual(appliedJob.sourcePackage,packageValue);assert.equal(appliedJob.sourcePackage.provenance.producer,'self-created live browser fixture');
 const history=await request(`/songs/${fixture.id}/history`);assert.ok(history.some(entry=>entry.score.notes.some(note=>note.id==='baseline-n'&&note.lyric==='旧')));checks.push('explicit checkbox and apply commit one new score revision, retain metadata, original score history and full submitted provenance');
 const midiResponse=await fetch(base+`/api/songs/${fixture.id}/export/midi`);assert.equal(midiResponse.status,200);assert.match(midiResponse.headers.get('content-type'),/audio\/midi/);const midi=Buffer.from(await midiResponse.arrayBuffer());await writeFile(path.join(out,'score.mid'),midi);assert.deepEqual(midiEvents(midi),[[0,144,62,90],[240,128,62,0],[240,144,76,90],[480,128,76,0],[960,144,57,90],[1920,128,57,0]]);checks.push('MIDI export contains valid header, 480 ticks per beat and exact sounding/rest timing');
 const xmlResponse=await fetch(base+`/api/songs/${fixture.id}/export/musicxml`);assert.equal(xmlResponse.status,200);const xml=await xmlResponse.text();await writeFile(path.join(out,'score.musicxml'),xml);
 const xmlNotes=await page.evaluate(text=>{const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('Invalid MusicXML');return {divisions:doc.querySelector('divisions')?.textContent,notes:Array.from(doc.querySelectorAll('part > measure > note')).map(note=>({duration:Number(note.querySelector('duration')?.textContent),rest:!!note.querySelector('rest'),step:note.querySelector('pitch > step')?.textContent??null,octave:note.querySelector('pitch > octave')?.textContent??null,alter:note.querySelector('pitch > alter')?.textContent??null}))};},xml);
 assert.equal(xmlNotes.divisions,'480');assert.deepEqual(xmlNotes.notes,[{duration:240,rest:false,step:'D',octave:'4',alter:'0'},{duration:240,rest:false,step:'E',octave:'5',alter:'0'},{duration:480,rest:true,step:null,octave:null,alter:null},{duration:960,rest:false,step:'A',octave:'3',alter:'0'}]);checks.push('MusicXML export preserves four exact durations, relative octaves and the rest');
 const projectResponse=await fetch(base+`/api/songs/${fixture.id}/export/project`);assert.equal(projectResponse.status,200);const project=await projectResponse.json();await writeFile(path.join(out,'project.json'),JSON.stringify(project,null,2));assert.deepEqual(project.score,current.score);assert.deepEqual(project.assets,current.assets);assert.deepEqual(project.score.notes.map(note=>note.sourceId),['page-1','page-1','page-1','page-1']);assert.ok(project.score.notes.every(note=>note.sourcePage===source.id));const sourceResponse=await fetch(base+source.url);assert.equal(sourceResponse.status,200);assert.deepEqual(Buffer.from(await sourceResponse.arrayBuffer()),sourceBytes);checks.push('project export retains compiled source references and exact fractions; job retains raw package, original image bytes unchanged');
 const staleJob=await request(`/songs/${fixture.id}/import-score`,{revision:current.revision,package:packageValue,sourceMapping:{'page-1':source.id}});const beforeStale=await request('/songs/'+fixture.id,{revision:current.revision,description:'Intentional synthetic version conflict'},'PATCH');
 await request(`/songs/${fixture.id}/jobs/${staleJob.id}/apply`,{revision:staleJob.baseRevision,removeOverlaps:false},'POST',409);await request(`/songs/${fixture.id}/jobs/${staleJob.id}/apply`,{revision:beforeStale.revision,removeOverlaps:false},'POST',409);await request(`/songs/${fixture.id}/import-score`,{revision:staleJob.baseRevision,package:packageValue},'POST',409);
 current=await request('/songs/'+fixture.id);assert.equal(current.revision,beforeStale.revision);assert.deepEqual(current.score,beforeStale.score);await openFixture();await page.locator('.job-item').filter({hasText:'外部转谱 · 等待人工核对'}).first().click();await page.getByText('此草稿之后工程已修改，为保护人工纠错，不能直接覆盖。请下载草稿并在校对表中对照合并。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'确认应用草稿',exact:true}).isDisabled(),true);checks.push('stale import and both stale/current revision apply attempts return409 without changing score; browser blocks stale apply');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile-stale-review.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));checks.push('deployed 390px external import and stale review stay within viewport');
 assert.deepEqual(runtimeErrors,[]);assert.deepEqual(unexpectedModelCalls,[]);assert.ok(writes.every(write=>write.path.includes('/songs/'+fixture.id+'/')));checks.push('no runtime errors, provider/settings changes or VLM submissions');
}catch(error){failure=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
 if(browser)await browser.close();
 if(fixture){try{const latest=await request('/songs/'+fixture.id);if(!latest.archived)await request('/songs/'+fixture.id,{revision:latest.revision,archived:true},'PATCH');archived=(await request('/songs/'+fixture.id)).archived;}catch(error){failure=(failure?failure+'; ':'')+'Fixture archive failed: '+String(error);}}
 const report={passed:checks.length,checks,runtimeErrors,unexpectedModelCalls,songId:fixture?.id,archived,appliedRevision,failed:!!failure,failure,writes};await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}


