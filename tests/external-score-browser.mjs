import {externalTranscriptionExample} from '../web/external-prompt.ts';
// Isolated synthetic UI exercise. Every API call is intercepted; no song or model is touched.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {build} from 'vite';
const require=createRequire('C:/Users/XIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/playwright-test.cjs');
const {chromium}=require('playwright');
const out=path.resolve('.run/external-score-v4-ui');await mkdir(out,{recursive:true});
const score={bpm:80,key:'C',timeSignature:[4,4],status:'corrected',phrases:[{id:'p',label:'Synthetic'}],notes:[{id:'n',beat:0,duration:1,midi:60,lyric:'字',phraseId:'p'}]};
const assetId='00000000-0000-4000-8000-000000000001';
const song={id:'synthetic-ui',revision:7,title:'Synthetic import fixture',artist:'',album:'',composer:'',lyricist:'',description:'',tags:[],links:{bilibili:'',qq:'',netease:''},coverId:null,assets:[{id:assetId,name:'synthetic.png',kind:'score',mime:'image/png',size:1,url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=',createdAt:'2026-10-28'}],score,alignment:{offset:0,anchors:[]},archived:false,createdAt:'2026-10-28',updatedAt:'2026-10-28'};
const sourcePackage={format:'shengjian.score',version:1,metadata:{title:'Synthetic',key:'C',bpm:80,timeSignature:[4,4]},sources:[{id:'page-1',name:'synthetic.png'}],phrases:[{id:'p',label:'Synthetic'}],measures:[{id:'m',sourceId:'page-1',row:1,notes:[{id:'n',degree:1,octave:0,duration:[1,1],phraseId:'p',lyric:'字'}]}],warnings:[],provenance:{producer:'Synthetic UI test'}};
const prompt={format:'shengjian.score',version:1,prompt:'Synthetic contextual prompt\npage-1 = synthetic.png\nPreserve unknowns and exact rational beats.',manifest:[{id:'page-1',name:'synthetic.png',assetId}]};
const format={format:'shengjian.score',version:1,schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object'},template:sourcePackage,prompt:'Synthetic generic prompt'};
console.log('Building isolated fixture');const dist=path.join(out,'dist');
await build({configFile:path.resolve('vite.config.ts'),configLoader:'runner',build:{outDir:dist,emptyOutDir:false}});
const server=createServer(async(request,response)=>{try{
 const target=path.resolve(dist,'.'+decodeURIComponent(new URL(request.url,'http://localhost').pathname));
 if(!target.startsWith(dist+path.sep)&&target!==dist)throw Error('outside fixture');
 const file=target===dist?path.join(dist,'index.html'):target;
 const contents=await readFile(file);response.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');response.end(contents);
 }catch{response.writeHead(404);response.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`,checks=[],runtimeErrors=[],requests=[];let browser,page,failure,jobs=[],rejectImport=false;
try{
 console.log('Launching fixture browser');
 browser=await chromium.launch({headless:true,channel:'msedge',timeout:15000});const context=await browser.newContext({viewport:{width:1360,height:1000}});context.setDefaultTimeout(8000);
 await context.addInitScript(()=>{window.__clipboardFails=true;window.__copied='';Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{if(window.__clipboardFails)throw Error('denied');window.__copied=value;}}});});
 page=await context.newPage();page.on('pageerror',error=>runtimeErrors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),key=request.method()+' '+url.pathname;requests.push({key,body:request.postDataJSON()});
  let body;
  if(key==='GET /api/songs')body=[song];
  else if(key==='GET /api/score-format')body=format;
  else if(key===`GET /api/songs/${song.id}/external-prompt`)body=prompt;
  else if(key===`GET /api/songs/${song.id}/history`)body=[];
  else if(key===`GET /api/songs/${song.id}/jobs`)body=jobs;
  else if(key===`POST /api/songs/${song.id}/import-score`){
   if(rejectImport){await route.fulfill({status:400,json:{error:'measures[0].notes[0].duration: rhythm evidence contradicts duration'}});return;}
   const job={id:'import-ui',songId:song.id,mode:'external',status:'review',progress:'Synthetic draft retained',baseRevision:7,createdAt:'2026-10-28',draft:{...score,status:'review'},warnings:['Synthetic bar anomaly retained'],qualityIssues:[{kind:'meter',message:'Synthetic bar needs review'}],sourcePackage:request.postDataJSON().package,sourceMapping:request.postDataJSON().sourceMapping||{},partial:true,coverageComplete:false,coverage:{'page-1':false},responses:[{content:'Synthetic provider evidence'}],pages:[{sourcePage:assetId}],workflow:{id:'synthetic-import',version:1},counters:{requests:0},checks:[{kind:'compile',passed:true,message:'Structural checks passed'},'Manual source comparison required'],trace:[{sequence:1,action:{tool:'validate'},ok:true,result:{message:'Synthetic host validation'}}]};jobs=[job];body=job;
  }else{await route.fulfill({status:500,json:{error:'Unexpected synthetic test request: '+key}});return;}
  await route.fulfill({json:body});
 });
 console.log('Opening fixture page',base);await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});await page.getByRole('button',{name:'打开歌曲 '+song.title,exact:true}).click();await page.getByRole('button',{name:'识谱',exact:true}).click();
 const input=page.getByLabel('外部转谱 JSON',{exact:true}),submit=page.getByRole('button',{name:'校验并创建审核草稿',exact:true});
 await page.getByRole('button',{name:'复制本曲转谱提示词',exact:true}).click();const fallback=page.getByLabel('可手动复制的转谱提示词');await fallback.waitFor();const fallbackText=await fallback.inputValue();assert.ok(fallbackText.startsWith(prompt.prompt));assert.match(fallbackText,/score\.shengjian\.score\.json/);assert.equal(await fallback.evaluate(element=>element.selectionEnd-element.selectionStart),fallbackText.length);checks.push('clipboard denial exposes and selects contextual prompt');
 await page.evaluate(()=>window.__clipboardFails=false);await page.getByRole('button',{name:'复制本曲转谱提示词',exact:true}).click();const copiedText=await page.evaluate(()=>window.__copied);assert.ok(copiedText.startsWith(prompt.prompt));assert.match(copiedText,/score\.shengjian\.score\.json/);checks.push('one click clipboard copies contextual manifest prompt');
 for(const [label,expected] of [['下载格式规范',format.schema],['下载示例模板',externalTranscriptionExample(format.template)]]){const event=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const download=await event;assert.deepEqual(JSON.parse(await readFile(await download.path(),'utf8')),expected);}checks.push('schema and template downloads contain server documents');
 await input.fill(JSON.stringify({...sourcePackage,sources:[{id:'page-1',name:{invalid:true}},{id:'__proto__',name:'special source'}]}));
 await page.getByText('关联本曲谱图（可选）',{exact:true}).click();await page.getByLabel('来源 page-1 对应谱图').waitFor();assert.equal(await page.getByLabel('来源 __proto__ 对应谱图').inputValue(),'');assert.deepEqual(runtimeErrors,[]);checks.push('malformed source names and prototype-like ids cannot crash or invent mappings');
 await input.fill('{');await submit.click();await page.getByRole('alert').filter({hasText:'JSON'}).waitFor();assert.equal(requests.filter(item=>item.key.startsWith('POST ')).length,0);checks.push('invalid JSON stays local with an actionable error');
 await input.fill('[]');await submit.click();await page.getByRole('alert').filter({hasText:'根节点'}).waitFor();assert.equal(requests.filter(item=>item.key.startsWith('POST ')).length,0);checks.push('non-object JSON cannot be submitted');
 await input.fill('汉'.repeat(699051));await submit.click();await page.getByRole('alert').filter({hasText:'2 MB'}).waitFor();assert.equal(requests.filter(item=>item.key.startsWith('POST ')).length,0);checks.push('UTF-8 paste size is limited by bytes before JSON parsing');
 const fileInput=page.getByLabel('导入外部转谱 JSON 文件',{exact:true}),validText=JSON.stringify(sourcePackage);
 await input.fill(validText);await fileInput.setInputFiles({name:'oversized.json',mimeType:'application/json',buffer:Buffer.alloc(2*1024*1024+1,32)});await page.getByRole('alert').filter({hasText:'2 MB'}).waitFor();assert.equal(await input.inputValue(),validText);checks.push('oversized files are refused while preserving the current text');
 await fileInput.setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from('\uFEFF'+validText)});await page.waitForFunction(text=>document.querySelector('[aria-label="外部转谱 JSON"]').value.replace(/^\uFEFF/,'')===text,validText);await input.fill('\uFEFF'+validText);rejectImport=true;await submit.click();await page.getByRole('alert').filter({hasText:'measures[0].notes[0].duration'}).waitFor();assert.equal(await input.inputValue(),'\uFEFF'+validText);checks.push('UTF-8 BOM files and pasted text import; server path errors retain original input');
 rejectImport=false;await input.fill(validText);assert.equal(await page.locator('.external-score-card [role="alert"]').count(),0);await submit.click();await page.getByRole('status').filter({hasText:'审核草稿'}).waitFor();const posted=requests.filter(item=>item.key.endsWith('/import-score')).at(-1);assert.deepEqual(posted.body,{revision:7,package:sourcePackage,sourceMapping:{'page-1':assetId}});assert.ok(await page.getByText('Synthetic bar anomaly retained',{exact:true}).isVisible());assert.ok(await page.getByText('Synthetic bar needs review',{exact:true}).isVisible());assert.equal(await page.getByRole('button',{name:'确认应用草稿',exact:true}).isDisabled(),true);assert.equal(requests.some(item=>item.key.includes('/apply')||item.key.endsWith('/recognize')),false);checks.push('editing clears errors and import sends current revision and mapping without auto apply or model calls');
 const traceDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载工作流记录',exact:true}).click();const traceFile=await traceDownload,traceRecord=JSON.parse(await readFile(await traceFile.path(),'utf8'));assert.deepEqual(traceRecord.trace,[{sequence:1,action:{tool:'validate'},ok:true,result:{message:'Synthetic host validation'}}]);assert.deepEqual(traceRecord.checks,[{kind:'compile',passed:true,message:'Structural checks passed'},'Manual source comparison required']);assert.equal(traceRecord.partial,true);assert.equal(traceRecord.coverageComplete,false);assert.deepEqual(traceRecord.coverage,{'page-1':false});assert.deepEqual(traceRecord.sourcePackage,sourcePackage);assert.deepEqual(traceRecord.sourceMapping,{'page-1':assetId});assert.deepEqual(traceRecord.responses,[{content:'Synthetic provider evidence'}]);assert.deepEqual(traceRecord.pages,[{sourcePage:assetId}]);checks.push('full job download preserves nested tools, coverage, source package and partial evidence');
 await page.locator('.external-source-mapping summary').click();await page.getByLabel('来源 page-1 对应谱图').selectOption('');await submit.click();await page.getByRole('status').filter({hasText:'审核草稿'}).waitFor();assert.equal('sourceMapping' in requests.filter(item=>item.key.endsWith('/import-score')).at(-1).body,false);checks.push('explicitly unassociated manifest source omits its asset mapping');
 const customPackage={...sourcePackage,sources:[{id:'manual-page',name:'Manual page'}],measures:[{...sourcePackage.measures[0],sourceId:'manual-page'}]};await input.fill(JSON.stringify(customPackage));await page.getByLabel('来源 manual-page 对应谱图').selectOption(assetId);await submit.click();await page.getByRole('status').filter({hasText:'审核草稿'}).waitFor();assert.deepEqual(requests.filter(item=>item.key.endsWith('/import-score')).at(-1).body.sourceMapping,{'manual-page':assetId});checks.push('custom external source ids can map only to the current song image');
 await page.getByRole('button',{name:'音符编辑',exact:true}).click();await page.getByText('导入 / 导出谱面草稿',{exact:true}).click();await page.getByLabel('导入谱面 JSON',{exact:true}).setInputFiles({name:'internal-score.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...score,notes:[{...score.notes[0],lyric:'本地旧稿'}]}))});await page.getByText('本地旧稿',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'保存谱面',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'识谱',exact:true}).click();assert.equal(await submit.isDisabled(),true);checks.push('raw internal Score import still edits local draft and blocks external import until resolved');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));checks.push('390px review and import layout has no horizontal overflow');
 assert.deepEqual(runtimeErrors,[]);
}catch(error){failure=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));const report={passed:checks.length,checks,runtimeErrors,failure,posts:requests.filter(item=>item.key.startsWith('POST ')).map(item=>item.key)};await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}



