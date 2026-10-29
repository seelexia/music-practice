// Rebuild offline documentation snapshots from the authoritative local API.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {externalTranscriptionPrompt,externalTranscriptionExample} from '../web/external-prompt.ts';
const base=process.env.MUSIC_URL||'http://127.0.0.1:3210';assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const response=await fetch(base+'/api/score-format');assert.ok(response.ok);
const data=await response.json();assert.equal(data.format,'shengjian.score');assert.equal(data.version,1);
await mkdir('docs/formats',{recursive:true});
for(const [name,value] of [['shengjian-score-v1.schema.json',JSON.stringify(data.schema,null,2)],['shengjian-score-v1.example.json',JSON.stringify(externalTranscriptionExample(data.template),null,2)],['external-transcription-prompt.zh-CN.txt',externalTranscriptionPrompt(data.prompt)]])await writeFile('docs/formats/'+name,value+'\n','utf8');
console.log('Exported schema, generic example and external transcription prompt snapshots');
