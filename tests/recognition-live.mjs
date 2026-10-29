// Starts one review-only live model job. Never applies or reads a reference answer.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const songId=process.argv[2];assert.match(songId??'',/^[a-f0-9-]{36}$/i);
const base=process.env.MUSIC_URL||'http://127.0.0.1:3210';assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const output=path.resolve(process.argv[3]||'.run/recognition-live');await mkdir(output,{recursive:true});
async function api(route,body){const r=await fetch(base+'/api'+route,{...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),headers:{'x-music-client':'web','content-type':'application/json'}});const value=await r.json();assert.ok(r.ok,`${r.status} ${value.error}`);return value;}
const before=await api(`/songs/${songId}`);await writeFile(path.join(output,'song-before.json'),JSON.stringify(before,null,2));
const started=await api(`/songs/${songId}/recognize`,{});await writeFile(path.join(output,'started.json'),JSON.stringify(started,null,2));console.log('Started review-only job',started.id);
let last='',job;const deadline=Date.now()+45*60*1000;
try{
 while(Date.now()<deadline){
  job=(await api(`/songs/${songId}/jobs`)).find(j=>j.id===started.id);assert.ok(job);
  await writeFile(path.join(output,'job.json'),JSON.stringify(job,null,2));
  const status=JSON.stringify({status:job.status,requests:job.counters?.requests,actions:job.counters?.actions,notes:job.draft?.notes?.length,progress:job.progress,error:job.error});
  if(status!==last){console.log(status);last=status;}
  if(!['running','queued'].includes(job.status))break;
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
}finally{
 const after=await api(`/songs/${songId}`);await writeFile(path.join(output,'song-after.json'),JSON.stringify(after,null,2));assert.deepEqual(after,before,'Live recognition must never mutate current song');
}
assert.equal(job?.status,'review',job?.error||'Job did not finish within observation deadline');
console.log(JSON.stringify({reviewJob:job.id,partial:job.partial,coverageComplete:job.coverageComplete,notes:job.draft?.notes?.length,warnings:job.warnings?.length}));
