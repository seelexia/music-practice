// Uses only a uniquely named, self-created song; archives it at the end.
// All other song writes, model/provider/settings and external requests are denied.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const require=createRequire('C:/Users/XIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/playwright-test.cjs'),{chromium}=require('playwright');
const base=process.env.MUSIC_FRONTEND_URL||'http://127.0.0.1:3210';assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const out=path.resolve('.run/wishlist-actual-live');await mkdir(out,{recursive:true});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function api(route,changes){const response=await fetch(base+'/api'+route,{method:changes?'PATCH':'GET',headers:{'X-Music-Client':'web','Content-Type':'application/json'},body:changes?JSON.stringify(changes):undefined});const value=await response.json();assert.ok(response.ok,route+': '+JSON.stringify(value));return value;}
const before=await api('/songs'),owned=new Set(),title='愿望单实际存储验收-'+Date.now();let browser,page,failure,initial;
const report={title,checks:[],errors:[],blocked:[],writes:[]};
await writeFile(path.join(out,'existing-before.json'),JSON.stringify(before.map(song=>({id:song.id,revision:song.revision,sha256:hash(song)})),null,2)+'\n');
try{
 browser=await chromium.launch({channel:'msedge',headless:true,timeout:20000});const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(15000);page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.route('**/*',async route=>{
  try{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  if(url.origin!==base||/\/(recognize|providers|settings|metadata)(\/|$)|lyrics\/align/.test(url.pathname)){report.blocked.push(method+' '+request.url());return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const id=/^\/api\/songs\/([^/]+)/.exec(url.pathname)?.[1],creating=method==='POST'&&url.pathname==='/api/songs';
  if(creating?request.postDataJSON().title!==title:method!=='GET'&&(!id||!owned.has(id))){report.blocked.push(method+' '+url.pathname);return route.abort();}
  if(method!=='GET')report.writes.push(method+' '+url.pathname);
  const response=await fetch(base+url.pathname+url.search,{method,headers:{'X-Music-Client':'web','Content-Type':'application/json'},body:request.postDataBuffer()??undefined});let bytes=Buffer.from(await response.arrayBuffer());
  if(creating&&response.ok){const created=JSON.parse(bytes);owned.add(created.id);initial=created;await writeFile(path.join(out,'owned-fixtures.json'),JSON.stringify({title,ids:[...owned]},null,2)+'\n');}
  if(method==='GET'&&url.pathname==='/api/songs'&&response.ok)bytes=Buffer.from(JSON.stringify(JSON.parse(bytes).filter(song=>owned.has(song.id))));
  await route.fulfill({status:response.status,contentType:response.headers.get('Content-Type')||'application/json',body:bytes});
  }catch(error){report.errors.push('request handler: '+String(error));await route.abort().catch(()=>{});}
 });
 const wishNav=()=>page.locator('.sidebar').getByRole('button',{name:'愿望单',exact:true}).click();
 await page.goto(base);await wishNav();await page.locator('.library-overview-heading').getByRole('button',{name:'添加愿望',exact:true}).click();const modal=page.getByRole('dialog');await modal.getByLabel('歌曲名称',{exact:true}).fill(title);await modal.getByRole('button',{name:'加入愿望单',exact:true}).click();await page.getByRole('region',{name:'愿望歌曲资料',exact:true}).waitFor();assert.equal(owned.size,1);const id=[...owned][0];let song=await api('/songs/'+id);
 assert.ok(song.tags.includes('愿望单'));assert.equal(song.assets.length,0);assert.deepEqual(song.score,initial.score);assert.deepEqual(song.alignment,initial.alignment);assert.equal(await page.locator('.workspace-tabs,.practice-panel').count(),0);report.checks.push('actual service creates a title-only wishlist with no assets/score mutation and no playback workspace');
 await page.getByLabel('歌手 / 演唱',{exact:true}).fill('合成验收歌手');await page.getByLabel('专辑',{exact:true}).fill('合成资料');await page.getByLabel('标签（用逗号分隔）',{exact:true}).fill('待练，英文');await page.getByLabel('QQ 音乐',{exact:true}).fill('https://i.y.qq.com/v8/playsong.html?songid=614799549');await page.getByRole('button',{name:'保存资料',exact:true}).click();await page.getByRole('button',{name:'已保存',exact:true}).waitFor();const saved=await api('/songs/'+id);assert.equal(saved.artist,'合成验收歌手');assert.ok(saved.tags.includes('愿望单')&&saved.tags.includes('待练')&&saved.tags.includes('英文'));assert.equal(saved.links.qq,'https://i.y.qq.com/v8/playsong.html?songid=614799549');
 await page.reload();await wishNav();await page.getByRole('button',{name:'打开歌曲 '+title,exact:true}).click();await page.getByRole('region',{name:'愿望歌曲资料',exact:true}).waitFor();assert.equal(await page.getByLabel('歌手 / 演唱',{exact:true}).inputValue(),saved.artist);report.checks.push('metadata/platform link/user tags/classification survive a real page reload and backend reread');
 await page.getByRole('button',{name:'开始补全',exact:true}).click();await page.getByRole('heading',{name:'把这首歌的碎片放在一起',exact:true}).waitFor();song=await api('/songs/'+id);assert.equal(song.id,saved.id);assert.equal(song.artist,saved.artist);assert.deepEqual(song.links,saved.links);assert.deepEqual(song.tags,saved.tags.filter(tag=>tag!=='愿望单'));assert.deepEqual(song.score,initial.score);assert.deepEqual(song.alignment,initial.alignment);assert.equal((await api('/songs/'+id+'/history')).length,0);report.checks.push('completion preserves actual song ID/metadata/score/alignment and opens assets without creating score history');
 await page.locator('.sidebar').getByRole('button',{name:'我的曲库',exact:true}).click();await page.locator(`.library-song-card[data-song-id="${id}"]`).waitFor();await wishNav();assert.equal(await page.locator(`.library-song-card[data-song-id="${id}"]`).count(),0);assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.checks.push('completed wish appears in ordinary library and leaves wishlist');
}catch(error){failure=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
 if(browser)await browser.close();for(const id of owned){const song=await api('/songs/'+id);if(!song.archived)await api('/songs/'+id,{revision:song.revision,archived:true});}
 const after=await api('/songs'),byId=new Map(after.map(song=>[song.id,song]));for(const original of before){assert.equal(hash(byId.get(original.id)),hash(original),'existing song changed: '+original.id);}
 report.existingSongsUnchanged=before.length;report.fixtureIds=[...owned];report.fixtureArchived=true;report.status=failure?'failed':'passed';report.failure=failure;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
