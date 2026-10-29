// Isolated real PitchCanvas with fixed notes; no API, model, source sample or audio input.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'vite';
const require=createRequire('C:/Users/XIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/playwright-test.cjs');
const {chromium}=require('playwright');
const root=process.cwd(),out=path.resolve('.run/pitch-reference'),dist=path.join(out,'dist');await mkdir(out,{recursive:true});
const html=path.join(out,'harness.html'),entry=path.join(out,'harness.tsx');
await writeFile(html,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="./harness.tsx"></script></body></html>');
await writeFile(entry,`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{PitchCanvas}from'../../web/audio/PitchCanvas';import'../../web/audio/practice.css';
const score={bpm:60,key:'D',timeSignature:[4,4],status:'reviewed',phrases:[],notes:[{id:'do',beat:0,duration:1,midi:62,degree:1},{id:'flat-re',beat:1,duration:1,midi:63,degree:2},{id:'rest',beat:2,duration:1,midi:null},{id:'narrow',beat:4,duration:.005,midi:67,degree:4},{id:'sol',beat:4.005,duration:1,midi:69,degree:5}]};
const points=[{at:0,beat:.2,midi:65,raw:65},{at:.1,beat:.5,midi:65,raw:65},{at:.2,beat:.8,midi:65,raw:65}];
function Harness(){const[state,setState]=useState({score,points,beat:.5,shift:1,range:[0,127],raw:false,secondsSpan:6,referenceActive:true,showReference:true});window.setPitchFixture=(patch)=>setState(old=>({...old,...patch}));return <main className="practice-panel" style={{width:'100%',boxSizing:'border-box'}}><div style={{height:320,display:'flex',flexDirection:'column'}}><PitchCanvas {...state} onRangeChange={range=>setState(old=>({...old,range}))} onSeek={beat=>setState(old=>({...old,beat}))}/></div></main>};createRoot(document.getElementById('root')).render(<Harness/>);`);
let server,browser;const report={checks:[],errors:[],blocked:[],databaseWrites:0};
try{
 await build({configFile:path.resolve('vite.config.ts'),configLoader:'runner',build:{outDir:dist,emptyOutDir:false,rollupOptions:{input:html}}});
 server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const file=pathname==='/'?path.join(dist,path.relative(root,html)):path.resolve(dist,'.'+decodeURIComponent(pathname));assert.ok(file.startsWith(dist+path.sep));res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1000,height:700}});page.setDefaultTimeout(5000);page.on('pageerror',error=>report.errors.push(error.message));
 await page.route('**/*',async route=>{const request=route.request();if(new URL(request.url()).origin!==base||request.method()!=='GET'||new URL(request.url()).pathname.startsWith('/api/')){report.blocked.push(request.method()+' '+request.url());return route.abort();}await route.continue();});
 await page.goto(base);
 const active=page.locator('.pitch-axis-notes button[aria-current="true"]'),solfege=page.getByLabel('显示唱名',{exact:true});
 assert.equal(await active.textContent(),'D♯4','actual shifted target must be highlighted even on sparse axis');
 assert.equal(await page.getByRole('button',{name:'试听 D♯4',exact:true}).count(),1,'active styling preserves the existing audition accessible name');
 assert.equal(await solfege.isChecked(),false);
 await page.getByLabel('显示半音',{exact:true}).uncheck();assert.equal(await active.textContent(),'D♯4','hidden accidentals keep current full note name');
 const highlight=await active.evaluate(node=>({background:getComputedStyle(node).backgroundColor,weight:getComputedStyle(node).fontWeight}));assert.notEqual(highlight.background,'rgba(0, 0, 0, 0)');assert.ok(Number(highlight.weight)>=600);
 report.checks.push('shifted D♯4 has visible active styling through sparse/natural-only axes');
 async function set(patch){await page.evaluate(patch=>window.setPitchFixture(patch),patch);await page.waitForTimeout(30);}
 for(const patch of [{beat:2.5},{beat:3.5},{beat:5.5},{beat:.5,referenceActive:false},{referenceActive:true,showReference:false},{showReference:true,liveTime:.2},{liveTime:null,range:[70,90]}]){if(patch.liveTime===null)patch.liveTime=undefined;await set(patch);assert.equal(await active.count(),0,JSON.stringify(patch));}
 await set({liveTime:undefined,range:[0,127],beat:.5});assert.equal(await active.textContent(),'D♯4');
 report.checks.push('rest, uncovered beat, ended event, inactive transport, hidden reference, live mode and outside-range target clear active label');
 await solfege.check();
 const references=page.locator('[data-pitch-label-kind="reference"]'),humans=page.locator('[data-pitch-label-kind="human"]');
 assert.equal(await page.locator('[data-pitch-label-kind="reference"][data-midi="63"]').getAttribute('data-solfege'),'do');
 assert.equal(await page.locator('[data-pitch-label-kind="reference"][data-midi="64"]').getAttribute('data-solfege'),'♭re');
 assert.equal(await humans.first().getAttribute('data-solfege'),'re');
 const narrow=page.locator('[data-pitch-label-kind="reference"][data-midi="68"]');assert.match(await narrow.getAttribute('title'),/fa/);assert.match(await narrow.getAttribute('aria-label'),/fa/);
 const clipping=await narrow.evaluate(node=>({overflow:getComputedStyle(node).overflow,width:node.clientWidth,textWidth:node.scrollWidth}));assert.equal(clipping.overflow,'hidden');assert.ok(clipping.width>0,'even a tiny reference retains a hover target for its full title');assert.ok(clipping.width<clipping.textWidth,'narrow labels retain full accessible text while visually clipping');
 await page.locator('[data-pitch-label-kind="reference"][data-midi="64"]').click();assert.equal(await active.textContent(),'E4','labels preserve click-to-seek on the chart');await set({beat:.5});
 const canvas=page.locator('canvas.pitch-canvas');await page.locator('[data-pitch-label-kind="reference"][data-midi="64"]').hover();await page.mouse.wheel(0,-120);await page.waitForTimeout(40);const zoomedSpan=Number(await canvas.getAttribute('data-range-high'))-Number(await canvas.getAttribute('data-range-low'));assert.ok(zoomedSpan<127,'wheel zoom bubbles through the solfege overlay');await set({range:[0,127]});
 await set({shift:3,points:[{at:0,beat:.2,midi:67,raw:67},{at:.1,beat:.5,midi:67,raw:67},{at:.2,beat:.8,midi:67,raw:67}]});assert.equal(await active.textContent(),'F4');assert.equal(await page.locator('[data-pitch-label-kind="reference"][data-midi="65"]').getAttribute('data-solfege'),'do');assert.equal(await humans.first().getAttribute('data-solfege'),'re');
 report.checks.push('reference and human blocks show movable-do, retain accidental spelling, transpose with unchanged syllables, clip narrow labels with full title/aria names, and preserve chart seek/wheel interactions');
 await page.screenshot({path:path.join(out,'pitch-reference-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:700});await set({range:[55,79]});assert.equal(await active.textContent(),'F4');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);await page.screenshot({path:path.join(out,'pitch-reference-mobile.png'),fullPage:true});
 await set({liveTime:.2,points:[{at:0,beat:0,midi:61,raw:61},{at:.1,beat:0,midi:61,raw:61},{at:.2,beat:0,midi:61,raw:61}]});assert.equal(await active.count(),0);assert.equal(await references.count(),0);assert.equal(await humans.first().getAttribute('data-solfege'),'♯do');
 await page.getByLabel('近似音符框',{exact:true}).uncheck();assert.equal(await humans.count(),0);await solfege.uncheck();assert.equal(await page.locator('[data-pitch-label-kind]').count(),0);
 report.checks.push('390px layout remains contained; independent listening uses C, no reference highlight, both optional displays can be disabled');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);throw error;}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify(report,null,2));}
