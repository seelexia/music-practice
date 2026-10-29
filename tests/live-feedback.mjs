import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const base=process.env.MUSIC_URL||'http://127.0.0.1:3210';
const sampleOnly=process.env.MUSIC_SAMPLE_ONLY==='1';
const out=sampleOnly?'.run/live-sample-v2':'.run/live-feedback';await mkdir(out,{recursive:true});
const report={checks:[],metadata:{},sample:{}};
async function api(route,body,method=body===undefined?'GET':'POST'){
 const response=await fetch(base+'/api'+route,{method,headers:{'x-music-client':'web','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();assert.ok(response.ok,`${route} ${response.status}: ${JSON.stringify(data)}`);return data;
}
async function job(songId,id){const until=Date.now()+15*60*1000;let progress='';while(Date.now()<until){const current=(await api(`/songs/${songId}/jobs`)).find(j=>j.id===id);assert.ok(current);if(current.progress!==progress){progress=current.progress;console.log(progress);}if(!['running','queued'].includes(current.status))return current;await new Promise(r=>setTimeout(r,3000));}throw Error('Model job timeout');}
let fixture;
try{
 if(!sampleOnly){
 for(const [platform,url] of Object.entries({qq:'https://i.y.qq.com/v8/playsong.html?songid=614799549#webchat_redirect',netease:'https://music.163.com/#/song?id=347230'})){
  const preview=await api('/metadata/preview',{url});assert.ok(preview.title);if(platform==='qq'){assert.equal(preview.title,'昔涟');assert.match(preview.artist,/张韶涵/);}report.metadata[platform]=preview;report.checks.push(platform+' public song share metadata preview');
 }
 fixture=await api('/songs',{title:'歌词校对验证（自动测试）',artist:'本地测试'});
 const lyrics='春风雨声\n山月星河';
 const score={bpm:120,key:'C',timeSignature:[4,4],status:'corrected',phrases:[{id:'old',label:'错误断句'}],notes:[60,62,64,65,67,69,71,72].map((midi,i)=>({id:'lyric-'+i,beat:i,duration:1,midi,lyric:'错',phraseId:'old'}))};
 fixture=await api('/songs/'+fixture.id,{revision:fixture.revision,score,tags:['internal-test']},'PATCH');
 fixture=await api('/songs/'+fixture.id,{revision:fixture.revision,links:{bilibili:'',qq:'https://i.y.qq.com/v8/playsong.html?songid=614799549#webchat_redirect',netease:'https://music.163.com/#/song?id=347230'}},'PATCH');
 report.checks.push('mobile QQ and NetEase fragment links saved');
 const revision=fixture.revision;
 const created=await api(`/songs/${fixture.id}/lyrics/align`,{revision,lyricsText:lyrics});
 const aligned=await job(fixture.id,created.id);await writeFile(out+'/lyrics-job.json',JSON.stringify(aligned,null,2));assert.equal(aligned.status,'review',aligned.error);
 const unchanged=await api('/songs/'+fixture.id);assert.equal(unchanged.revision,revision);assert.equal(unchanged.lyricsText||'','');assert.deepEqual(unchanged.score,score);
 report.checks.push('real local VLM lyric draft does not mutate song');
 fixture=await api(`/songs/${fixture.id}/jobs/${created.id}/apply`,{revision,removeOverlaps:false});assert.equal(fixture.lyricsText,lyrics);
 const core=notes=>notes.map(({lyric,phraseId,...rest})=>rest);assert.deepEqual(core(fixture.score.notes),core(score.notes));assert.deepEqual(fixture.score.phrases.map(p=>p.label),lyrics.split('\n'));assert.equal(fixture.score.notes.map(n=>n.lyric).join(''),lyrics.replace('\n',''));
 report.checks.push('lyric apply preserves every note ID, pitch, beat and duration, exact line coverage');
 }
 const sampleId=(await readFile('.run/sample-song-id.txt','utf8')).trim();const before=await api('/songs/'+sampleId);
 const started=await api(`/songs/${sampleId}/recognize`,{});await writeFile(out+'/sample-job-id.txt',started.id);console.log('Sample draft job: '+started.id);
 const sampleJob=await job(sampleId,started.id);await writeFile(out+'/sample-job.json',JSON.stringify(sampleJob,null,2));assert.equal(sampleJob.status,'review',sampleJob.error);
 const after=await api('/songs/'+sampleId);assert.deepEqual(after,before,'Existing sample changed during recognition');
 const end=Math.max(...sampleJob.draft.notes.map(n=>n.beat+n.duration));
 report.sample={jobId:started.id,revision:before.revision,sourcePages:sampleJob.preprocessing.sourcePages,segments:sampleJob.preprocessing.segments,noteCount:sampleJob.draft.notes.length,measures:sampleJob.draft.measures?.length||0,bpm:sampleJob.draft.bpm,seconds:end*60/sampleJob.draft.bpm,warnings:sampleJob.warnings,qualityIssues:sampleJob.qualityIssues};
 assert.ok(sampleJob.preprocessing.segments>sampleJob.preprocessing.sourcePages);assert.ok(sampleJob.draft.measures.length>0);report.checks.push('real sample row recognition preserves original song and creates measure-aware draft');
}catch(error){report.error=String(error);throw error;}finally{
 if(fixture){const latest=await api('/songs/'+fixture.id);await api('/songs/'+fixture.id,{revision:latest.revision,archived:true},'PATCH');}
 await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
