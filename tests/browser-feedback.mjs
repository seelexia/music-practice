import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';

// This regression creates and archives its own song. Existing library songs are read only.
const require=createRequire('C:/Users/XIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/playwright-test.cjs');
const {chromium}=require('playwright');
const base=process.env.MUSIC_URL||'http://127.0.0.1:3210';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Use a local service for this regression');
const out=path.resolve('.run/browser-feedback');
const dataRoot=path.resolve(process.env.MUSIC_DATA_ROOT||'data');
await mkdir(out,{recursive:true});
const wav=Buffer.alloc(44+48000*8*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<48000*8;i++)wav.writeInt16LE(Math.round(10000*Math.sin(i/48000*2*Math.PI*261.625565)),44+i*2);
const fakeMic=path.join(out,'fake-c4.wav');await writeFile(fakeMic,wav);
async function api(route,body,method=body===undefined?'GET':'POST',headers={}){
 const response=await fetch(base+'/api'+route,{method,headers:{'x-music-client':'web','content-type':'application/json',...headers},...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)})});
 const result=await response.json();assert.ok(response.ok,`${route}: ${response.status} ${JSON.stringify(result)}`);return result;
}
async function until(check,label,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,60));}throw Error(`Timed out: ${label}`);}
async function exists(file){try{await stat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function assetPath(id){assert.match(id,/^[0-9a-f-]{36}$/i);return path.join(dataRoot,'assets',id);}
const title=`交互反馈回归 ${new Date().toISOString()}`;
const checks=[],runtimeErrors=[],consoleErrors=[],httpErrors=[];
let fixture,browser,context,page,failure,cleanupError,archived=false,deletedRecording;
try{
 fixture=await api('/songs',{title,artist:'本机自动回归'});
 const score={bpm:120,key:'C',timeSignature:[4,4],status:'corrected',phrases:[{id:'p1',label:'前句'},{id:'p2',label:'后句'}],notes:[60,62,64,65,67,69,67,64].map((midi,i)=>({id:'f'+i,beat:i,duration:1,midi,lyric:['一','二','三','四','五','六','七','八'][i],phraseId:i<4?'p1':'p2'}))};
 fixture=await api('/songs/'+fixture.id,{revision:fixture.revision,score,tags:['internal-test','feedback-regression']},'PATCH');
 fixture=await api(`/songs/${fixture.id}/assets?kind=audio`,wav,'POST',{'content-type':'audio/wav','x-file-name':'feedback-source-c4.wav'});
 const source=fixture.assets.find(asset=>asset.kind==='audio');assert.ok(source);assert.ok(await exists(assetPath(source.id)));
 checks.push('own eight-note song and original audio fixture created');
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${fakeMic}`,'--autoplay-policy=no-user-gesture-required']});
 context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['microphone'],acceptDownloads:true});
 page=await context.newPage();page.on('pageerror',error=>runtimeErrors.push(error.message));page.on('console',entry=>{if(entry.type()==='error')consoleErrors.push(entry.text());});page.on('response',response=>{if(response.status()>=400)httpErrors.push(`${response.status()} ${response.url()}`);});
 await page.goto(base);await page.locator('.song-item').filter({hasText:title}).click();await page.getByRole('heading',{name:title,exact:true}).waitFor();
 const transport=()=>page.locator('.compact-transport');
 const scorePane=()=>page.locator('.score-card:visible');
 const readBeat=async()=>Number.parseFloat(await transport().locator('.position-readout span').textContent());
 const state=async()=>await transport().locator('.transport-status').textContent();
 const setSpeed=async value=>{const input=page.getByLabel('练习速度',{exact:true});await input.fill(String(value));await input.press('Enter');};
 const advanced=async()=>{const detail=transport().locator('.transport-advanced');if(!await detail.evaluate(node=>node.open))await detail.locator('summary').click();};

 await page.getByRole('button',{name:'原音对齐',exact:true}).click();
 const rawAudio=page.locator('.alignment-card audio');await rawAudio.waitFor();await until(()=>rawAudio.evaluate(audio=>Number.isFinite(audio.duration)&&audio.duration>7),'native audio duration');
 await rawAudio.evaluate(audio=>audio.play());await until(()=>rawAudio.evaluate(audio=>audio.currentTime>.2),'independent native audio playback');
 assert.equal(await scorePane().locator('.score-note.active').getAttribute('data-note-id'),'f0');await rawAudio.evaluate(audio=>audio.pause());
 await page.getByLabel('对齐原音频秒数',{exact:true}).fill('1.25');
 await scorePane().locator('[data-note-id="f6"]').click();await until(async()=>await page.getByLabel('对齐谱面拍位置',{exact:true}).inputValue()==='6','score note selects its alignment beat');assert.equal(+await rawAudio.evaluate(audio=>audio.currentTime),1.25);
 await page.getByLabel('对齐谱面拍位置',{exact:true}).fill('8');await page.getByRole('button',{name:'将此音对齐当前原音频',exact:true}).click();
 assert.match(await page.locator('.alignment-card').innerText(),/偏移 -2.75 秒/);await page.getByRole('button',{name:'保存对齐',exact:true}).click();await page.getByText(/对齐已保存，音频和谱面进度已归零/).waitFor();
 fixture=await api('/songs/'+fixture.id);assert.equal(fixture.alignment.offset,-2.75);assert.equal(+await page.getByLabel('对齐原音频秒数',{exact:true}).inputValue(),0);assert.equal(await rawAudio.evaluate(audio=>audio.currentTime),0);
 checks.push('independent raw clock, score selection and negative offset save reset progress');
 await page.screenshot({path:path.join(out,'alignment-desktop.png'),fullPage:true});
 await page.getByLabel('对齐方式',{exact:true}).selectOption('anchors');await page.getByLabel('对齐谱面拍位置',{exact:true}).fill('0');await page.getByRole('button',{name:'将此音对齐当前原音频',exact:true}).click();await page.getByLabel('对齐原音频秒数',{exact:true}).fill('2');await page.getByLabel('对齐谱面拍位置',{exact:true}).fill('8');await page.getByRole('button',{name:'将此音对齐当前原音频',exact:true}).click();await page.getByText('由两个锚点估算：240.00 BPM · 2.00×',{exact:true}).waitFor();await page.getByRole('button',{name:'应用估算的钢琴练习速度',exact:true}).click();await page.getByRole('button',{name:'保存对齐',exact:true}).click();await until(async()=>{const current=await api('/songs/'+fixture.id);return current.alignment.anchors.length===2;},'two alignment anchors save');fixture=await api('/songs/'+fixture.id);assert.equal(fixture.score.bpm,120);assert.deepEqual(fixture.alignment.anchors,[{beat:0,seconds:0},{beat:8,seconds:2}]);
 await page.getByRole('button',{name:'重置对齐',exact:true}).click();await page.getByLabel('对齐原音频秒数',{exact:true}).fill('1.25');await page.getByLabel('对齐谱面拍位置',{exact:true}).fill('8');await page.getByRole('button',{name:'将此音对齐当前原音频',exact:true}).click();await page.getByRole('button',{name:'保存对齐',exact:true}).click();await until(async()=>{const current=await api('/songs/'+fixture.id);return current.alignment.anchors.length===0&&current.alignment.offset===-2.75;},'reset anchors and restore negative offset');checks.push('two saved anchors estimate piano tempo, preserve printed BPM, and can reset to offset');

 await page.getByRole('button',{name:'练习',exact:true}).click();await page.getByRole('button',{name:'原音频',exact:true}).click();assert.ok(await page.getByLabel('练习速度',{exact:true}).isDisabled());
 await page.getByRole('button',{name:'回到开头',exact:true}).click();await page.getByRole('button',{name:'播放',exact:true}).click();await until(async()=>await state()==='播放中','original play with negative offset');assert.ok(await readBeat()>=5.5);assert.ok(await readBeat()<7);await page.getByRole('button',{name:'暂停',exact:true}).click();
 checks.push('negative offset original playback starts at audio zero rather than throwing');
 await page.getByRole('button',{name:'按谱钢琴',exact:false}).click();await setSpeed(.37);assert.equal(await page.getByLabel('练习速度',{exact:true}).inputValue(),'0.37');await until(async()=>await page.getByLabel('实际练习BPM',{exact:true}).inputValue()==='44.4','speed updates effective BPM');
 await page.getByLabel('实际练习BPM',{exact:true}).fill('111');await page.getByLabel('实际练习BPM',{exact:true}).press('Enter');assert.equal(await page.getByLabel('实际练习BPM',{exact:true}).inputValue(),'111');await setSpeed(1);
 checks.push('hundredth-precision continuous speed and custom effective BPM');
 await page.getByRole('button',{name:'回到开头',exact:true}).click();await page.getByLabel('点击音符提前拍数',{exact:true}).fill('1');await scorePane().locator('[data-note-id="f2"]').click();await until(async()=>await state()==='播放中','exact note click autoplay');const firstBeat=await readBeat();assert.ok(firstBeat>=1&&firstBeat<1.8,`click note at beat 2 starts from beat 1: ${firstBeat}`);
 await until(async()=>await readBeat()>4.2,'continuous play beyond clicked note owning phrase');assert.equal(await state(),'播放中');await page.getByRole('button',{name:'暂停',exact:true}).click();
 checks.push('exact-note one-beat preroll continues beyond its phrase');

 await scorePane().getByRole('button',{name:'选循环',exact:true}).click();await scorePane().locator('[data-note-id="f2"]').click();await scorePane().locator('[data-note-id="f4"]').click();assert.equal(await state(),'已暂停');assert.ok(await page.getByLabel('A / B 循环',{exact:true}).isChecked());await advanced();assert.equal(await page.getByLabel('A 拍',{exact:true}).inputValue(),'2');assert.equal(await page.getByLabel('B 拍',{exact:true}).inputValue(),'5');
 await page.getByLabel('间隔（秒）',{exact:true}).fill('0.65');await page.getByLabel('总遍数',{exact:true}).fill('2');await setSpeed(2);await page.getByLabel('播放位置（拍）',{exact:true}).fill('0');
 await page.evaluate(()=>{window.__loopTrace=[];window.__traceLoop=true;let last='';const trace=()=>{if(!window.__traceLoop)return;const node=document.querySelector('.compact-transport .transport-status'),value=node?.textContent;if(value!==last){last=value;window.__loopTrace.push({state:value,at:performance.now()});}requestAnimationFrame(trace);};trace();});
 await page.getByRole('button',{name:'播放',exact:true}).click();await until(async()=>await state()==='播放中','A/B loop start');assert.ok(await readBeat()>=2&&await readBeat()<2.8,'playing outside A/B starts at A');await until(async()=>await state()==='循环间隔','loop enters real-second gap');await until(async()=>await state()==='已暂停'&&Math.abs(await readBeat()-5)<.01,'finite loop stops at B');
 const trace=await page.evaluate(()=>{window.__traceLoop=false;return window.__loopTrace;});const gap=trace.findIndex(entry=>entry.state==='循环间隔');assert.ok(gap>=0&&trace[gap+1]?.state==='播放中',JSON.stringify(trace));const gapSeconds=(trace[gap+1].at-trace[gap].at)/1000;assert.ok(gapSeconds>.45&&gapSeconds<.9,`gap at 2x remains 0.65 real seconds: ${gapSeconds}`);
 await scorePane().getByRole('button',{name:'清除循环',exact:true}).click();assert.ok(!await page.getByLabel('A / B 循环',{exact:true}).isChecked());assert.equal(await scorePane().locator('.in-loop').count(),0);await setSpeed(1);await transport().locator('.transport-advanced summary').click();
 checks.push(`score-selected A/B, no selection autoplay, clear and real gap (${gapSeconds.toFixed(3)}s at 2x)`);

 await page.getByRole('button',{name:'音符编辑',exact:true}).click();const editor=page.locator('.notation-editor:visible');const inspector=editor.locator('.note-inspector');const noteCount=()=>editor.locator('.editor-sheet [data-note-id]').evaluateAll(nodes=>new Set(nodes.map(node=>node.dataset.noteId)).size);
 await editor.locator('.editor-sheet [data-note-id="f2"]').click();await page.getByLabel('音高数字或唱名',{exact:true}).fill('re');await page.getByLabel('音符时值',{exact:true}).fill('0.5');await page.getByLabel('当前音符歌词',{exact:true}).fill('测');await page.getByLabel('当前音符歌词',{exact:true}).press('Enter');await until(()=>editor.locator('[data-note-id="f2"]').first().getAttribute('aria-label').then(label=>label.includes('0.5 拍')&&label.includes('测')),'Enter applies human note edits');
 await inspector.getByRole('button',{name:'后插',exact:true}).click();assert.equal(await noteCount(),9);await inspector.getByRole('button',{name:'删除',exact:true}).click();assert.equal(await noteCount(),8);await editor.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await noteCount(),9);await editor.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await noteCount(),8);await editor.getByRole('button',{name:'撤销',exact:true}).click();await editor.locator('.editor-sheet [data-note-id="f2"]').click();assert.equal(await page.getByLabel('音符时值',{exact:true}).inputValue(),'1');assert.equal(await page.getByLabel('当前音符歌词',{exact:true}).inputValue(),'三');
 await page.getByLabel('音高数字或唱名',{exact:true}).fill('re');await page.getByLabel('当前音符歌词',{exact:true}).fill('测');await page.getByLabel('当前音符歌词',{exact:true}).press('Enter');await editor.getByRole('button',{name:'保存谱面',exact:true}).click();await until(async()=>{const current=await api('/songs/'+fixture.id);return current.score.notes.find(note=>note.id==='f2').midi===62;},'manual score save');fixture=await api('/songs/'+fixture.id);assert.equal(fixture.score.notes.length,8);assert.equal(fixture.score.notes.find(note=>note.id==='f3').beat,3);
 checks.push('human pitch and duration Enter, insert/delete, undo and saved correction');
 await page.screenshot({path:path.join(out,'editor-desktop.png'),fullPage:true});

 await page.getByRole('button',{name:'练习',exact:true}).click();await page.getByRole('button',{name:'谱面 + 音高',exact:true}).click();const divider=page.getByRole('separator',{name:'调整谱面与音高区域大小'});const initialSplit=+await divider.getAttribute('aria-valuenow');await divider.focus();await divider.press('ArrowLeft');assert.equal(+await divider.getAttribute('aria-valuenow'),initialSplit-2);const box=await divider.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-30,box.y+box.height/2);await page.mouse.up();assert.ok(+await divider.getAttribute('aria-valuenow')<initialSplit-2);
 await page.getByRole('button',{name:'页面全屏',exact:true}).click();await page.locator('.practice-panel.is-page-fullscreen').waitFor();assert.equal(await page.evaluate(()=>document.fullscreenElement),null);assert.ok((await page.locator('.practice-panel.is-page-fullscreen').boundingBox()).height>=990);await page.getByRole('button',{name:'退出页面全屏',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.practice-panel.is-page-fullscreen'));await page.getByRole('button',{name:'改为上下排列',exact:true}).click();assert.equal(await divider.getAttribute('aria-orientation'),'horizontal');await page.getByRole('button',{name:'改为左右排列',exact:true}).click();
 checks.push('pointer and keyboard split resize, vertical arrangement and browser-internal fullscreen');
 await page.getByRole('button',{name:'启用麦克风',exact:true}).click();await page.getByRole('button',{name:'关闭麦克风',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.pitch-readout > strong')?.textContent==='C4');const devices=page.getByLabel('麦克风输入设备',{exact:true});const explicit=await devices.locator('option').evaluateAll(options=>options.find(option=>option.value&&option.value!=='default')?.value);assert.ok(explicit,'fake input enumerates after permission');await devices.selectOption(explicit);await page.getByRole('button',{name:'关闭麦克风',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.pitch-readout > strong')?.textContent==='C4');await page.getByLabel('音高网格下界',{exact:true}).fill('50');await page.getByLabel('音高网格上界',{exact:true}).fill('75');await page.getByLabel('音高横轴时间范围',{exact:true}).fill('25');assert.equal(await page.getByLabel('音高网格下界',{exact:true}).inputValue(),'50');await page.getByRole('button',{name:'放大音域',exact:true}).click();assert.ok(+await page.getByLabel('音高网格上界',{exact:true}).inputValue()-+await page.getByLabel('音高网格下界',{exact:true}).inputValue()<25);
 checks.push('fake C4, exact microphone device switch, independent pitch range and seconds span');
 await page.screenshot({path:path.join(out,'practice-split-desktop.png'),fullPage:true});

 await page.getByRole('button',{name:'开始录音',exact:true}).click();await page.getByRole('button',{name:/停止录音/}).waitFor();assert.ok(await devices.isDisabled(),'device switching disabled while recording');await new Promise(resolve=>setTimeout(resolve,1200));await page.getByRole('button',{name:/停止录音/}).click();await page.getByText('已保存人声与练习事件，可从下方回放',{exact:true}).waitFor();fixture=await api('/songs/'+fixture.id);const recording=fixture.assets.find(asset=>asset.kind==='recording');assert.ok(recording?.take?.events?.length);assert.ok(recording.take.pitch.length>0);assert.ok(await exists(assetPath(recording.id)));assert.ok((await fetch(base+recording.url)).ok);
 checks.push('real microphone recording binary and playback snapshot persist');
 await page.getByRole('button',{name:'关闭麦克风',exact:true}).click();await page.getByRole('button',{name:'录音',exact:true}).click();await page.getByRole('button',{name:'人声',exact:true}).click();await page.locator('.take-player audio').waitFor();await page.getByRole('button',{name:'删除录音及文件',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();assert.ok((await fetch(base+recording.url)).ok);await page.getByRole('button',{name:'删除录音及文件',exact:true}).click();await page.getByRole('button',{name:'确认删除录音及文件',exact:true}).click();await page.getByText('还没有录音，从一句开始。',{exact:true}).waitFor();assert.equal(await page.locator('.take-player').count(),0);assert.equal((await fetch(base+recording.url)).status,404);assert.equal(await exists(assetPath(recording.id)),false);fixture=await api('/songs/'+fixture.id);assert.ok(!fixture.assets.some(asset=>asset.id===recording.id));assert.ok((await fetch(base+source.url)).ok);assert.ok(await exists(assetPath(source.id)));deletedRecording=recording.id;
 checks.push('recording delete cancellation then confirmation stops replay, removes metadata/file and preserves source');

 await page.getByRole('button',{name:'独立音高',exact:true}).click();await page.getByRole('heading',{name:'独立测音',exact:true}).waitFor();await page.getByRole('button',{name:'启用麦克风',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.pitch-readout > strong')?.textContent==='C4');assert.equal(await page.locator('.transport-card').count(),0);await page.getByRole('button',{name:'关闭麦克风',exact:true}).click();await page.screenshot({path:path.join(out,'standalone-pitch-desktop.png'),fullPage:true});
 checks.push('standalone pitch works without score transport');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:path.join(out,'standalone-pitch-mobile.png'),fullPage:true});await page.locator('.song-item').filter({hasText:title}).click();await page.getByRole('button',{name:'练习',exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:path.join(out,'practice-mobile.png'),fullPage:true});
 checks.push('390px standalone pitch and practice have no horizontal overflow');
 assert.deepEqual(runtimeErrors,[],'browser runtime errors');assert.deepEqual(consoleErrors,[],'browser console errors');assert.deepEqual(httpErrors,[],'unexpected browser HTTP errors');
}catch(error){failure=error;if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(path.join(out,'failure-body.txt'),await page.locator('body').innerText().catch(()=>''));}}
finally{
 await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
 if(fixture){try{const latest=await api('/songs/'+fixture.id);await api('/songs/'+fixture.id,{revision:latest.revision,archived:true},'PATCH');archived=true;}catch(error){cleanupError=String(error);}}
}
const report={passed:checks.length,checks,songId:fixture?.id,deletedRecording,archived,runtimeErrors,consoleErrors,httpErrors,...(failure?{error:String(failure)}:{}),...(cleanupError?{cleanupError}:{})};
await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(failure)throw failure;if(cleanupError)throw Error(cleanupError);
