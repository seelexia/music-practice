// Live visual holdouts with independently generated notation. Expected answers stay offline.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const base=process.env.MUSIC_URL||'http://127.0.0.1:3210';assert.equal(new URL(base).hostname,'127.0.0.1');
const out=path.resolve(process.argv[2]||'.run/evaluation-v4/synthetic-live');await mkdir(out,{recursive:true});
async function api(route,body,method=body===undefined?'GET':'POST',headers={}){const r=await fetch(base+'/api'+route,{method,headers:{'X-Music-Client':'web','Content-Type':'application/json',...headers},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});const v=await r.json();assert.ok(r.ok,`${r.status}: ${v.error}`);return v;}
const runs=[];
for(const name of ['serif','sans']){
 let song=await api('/songs',{title:`识谱独立合成测试 ${name} ${new Date().toISOString()}`,artist:'自动验收夹具'});let status;
 try{
  const png=await readFile(path.resolve('.run/evaluation-v4/synthetic',name+'.png'));
  song=await api(`/songs/${song.id}/assets?kind=score`,png,'POST',{'Content-Type':'image/png','X-File-Name':name+'.png'});
  const runPath=path.join(out,name);await mkdir(runPath,{recursive:true});
  status=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tests/recognition-live.mjs',song.id,runPath],{stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',resolve);});
  runs.push({name,songId:song.id,observerExit:status,output:runPath});
 }finally{
  const latest=await api(`/songs/${song.id}`);await api(`/songs/${song.id}`,{revision:latest.revision,archived:true,tags:['internal-test','vision-holdout']},'PATCH');
 }
}
await writeFile(path.join(out,'runs.json'),JSON.stringify(runs,null,2));console.log(JSON.stringify(runs));
