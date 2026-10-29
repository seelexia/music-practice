import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import path from 'node:path';

const require=createRequire('C:/Users/XIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/playwright-test.cjs');
const {chromium}=require('playwright');
const score={bpm:80,key:'C',timeSignature:[4,4],status:'reviewed',phrases:[{id:'p',label:'old'}],notes:[0,1,2].map(i=>({id:`n${i}`,beat:i,duration:1,midi:60+i,lyric:'旧',phraseId:'p'}))};
let song={id:'lyrics-fixture',revision:5,title:'歌词请求夹具',artist:'',album:'',composer:'',lyricist:'',description:'',lyricsText:'服务器旧歌词',tags:[],links:{bilibili:'',qq:'',netease:''},coverId:null,assets:[{id:'image',name:'fixture.png',kind:'score',mime:'image/png',size:1,url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',createdAt:'2026-10-27'}],score,alignment:{offset:0,anchors:[]},archived:false,createdAt:'2026-10-27',updatedAt:'2026-10-27'};
const oldJob={id:'old',songId:song.id,status:'review',progress:'旧识谱草稿',baseRevision:5,draft:score,overlaps:[{start:1,count:1,reason:'fixture overlap'}],createdAt:'2026-10-27'};
let jobs=[oldJob];const writes=[];let releaseAlignment;const alignmentGate=new Promise(resolve=>{releaseAlignment=resolve;});
const server=await createServer({root:process.cwd(),cacheDir:path.resolve('.run/lyrics-browser-cache'),server:{host:'127.0.0.1',port:0,strictPort:true,watch:{ignored:['**/target/**','**/.run/**','**/.tools/**','**/data/**']}}});
await server.listen();const address=server.httpServer.address();assert.ok(address&&typeof address==='object');
const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method(),body=request.postDataJSON();
  if(method!=='GET')writes.push({path:url.pathname,method,body});
  let value;
  if(url.pathname==='/api/songs'&&method==='GET')value=[song];
  else if(url.pathname.endsWith('/history'))value=[];
  else if(url.pathname.endsWith('/jobs'))value=jobs;
  else if(url.pathname.endsWith('/lyrics/align')){await alignmentGate;value={id:'lyrics',songId:song.id,mode:'lyrics',status:'failed',progress:'模型未完成，输入已保存',error:'fixture failure',baseRevision:5,lyricsText:body.lyricsText,createdAt:'2026-10-27'};jobs=[value,...jobs];}
  else if(url.pathname.endsWith('/recognize')){value={...oldJob,id:'new',mode:'recognition',progress:'新识谱草稿'};jobs=[value,...jobs];}
  else if(url.pathname===`/api/songs/${song.id}`&&method==='PATCH'){song={...song,...body,revision:song.revision+1};value=song;}
  else if(url.pathname===`/api/songs/${song.id}`)value=song;
  else return route.fulfill({status:404,json:{error:'unexpected fixture request'}});
  await route.fulfill({json:value});
});
try{
 await page.goto(`http://127.0.0.1:${address.port}`);await page.getByRole('heading',{name:song.title,exact:true}).waitFor();
 await page.locator('.workspace-tabs').getByRole('button',{name:'识谱',exact:true}).click();
 const text=page.getByLabel('手动输入准确歌词，每行一句');await text.fill('你\n好');
 await page.getByRole('button',{name:'按手动歌词校对断句',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'开始识谱',exact:true}).isDisabled(),true,'normal recognition cannot race an in-flight lyric submission');
 assert.equal(await page.getByRole('button',{name:'保存手动歌词',exact:true}).isDisabled(),true,'explicit save cannot race the lyric submission');
 releaseAlignment();
 await page.getByText('fixture failure',{exact:true}).waitFor();
 assert.equal(writes.filter(r=>r.method==='PATCH').length,0,'refinement must not save or advance the song before review');
 assert.deepEqual(writes.find(r=>r.path.endsWith('/lyrics/align')).body,{revision:5,lyricsText:'你\n好'});
 await page.getByText('本次提交的手动歌词',{exact:true}).click();assert.equal(await page.locator('.submitted-lyrics pre').innerText(),'你\n好');
 await page.locator('.job-item').filter({hasText:'旧识谱草稿'}).click();
 await page.getByRole('checkbox',{name:/我已审阅草稿/}).check();await page.getByRole('checkbox',{name:/确认移除上述重叠/}).check();
 await text.fill('新的未保存歌词');await page.getByRole('button',{name:'开始识谱',exact:true}).click();
 await page.locator('.job-item').filter({hasText:'新识谱草稿'}).waitFor();
 assert.deepEqual(writes.find(r=>r.path.endsWith('/recognize')).body,{lyricsText:'新的未保存歌词'});
 assert.equal(await page.getByRole('checkbox',{name:/我已审阅草稿/}).isChecked(),false,'a new job needs fresh review confirmation');
 assert.equal(await page.getByRole('checkbox',{name:/确认移除上述重叠/}).isChecked(),false,'a new job needs fresh overlap permission');
 await text.fill('明确保存的歌词');await page.getByRole('button',{name:'保存手动歌词',exact:true}).click();
 await page.getByText('手动歌词已保存。',{exact:true}).waitFor();
 assert.deepEqual(writes.filter(r=>r.method==='PATCH').map(r=>r.body),[{lyricsText:'明确保存的歌词',revision:5}]);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:6,checks:['refine does not PATCH','failed job lyrics recoverable','recognition uses unsaved manual draft','new job resets review and overlap permission','explicit save PATCHes versioned lyrics','in-flight lyrics submission blocks competing writes']},null,2));
}finally{releaseAlignment();await browser.close();await server.close();}
