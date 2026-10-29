import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Song} from './types';
import {batchTags,parseBatchTags,runLibraryBatch} from './library-batch.ts';
test('batch tag edits normalize requests and preserve unrelated original tags',()=>{
 assert.deepEqual(parseBatchTags('练习， Vocal ; vocal\n新歌'),['练习','Vocal','新歌']);
 assert.deepEqual(batchTags([' 抒情 ','VOCAL'],['vocal','练习'],'add'),[' 抒情 ','VOCAL','练习']);
 assert.deepEqual(batchTags(['抒情','Vocal','vocal'],[' VOCAL '],'remove'),['抒情']);
 assert.throws(()=>parseBatchTags(' '));assert.throws(()=>parseBatchTags('x'.repeat(101)));
 assert.deepEqual(parseBatchTags('字'.repeat(33)),['字'.repeat(33)]);assert.throws(()=>parseBatchTags('字'.repeat(34)));
 assert.throws(()=>batchTags(Array.from({length:100},(_,i)=>`tag${i}`),['另一个'],'add'));
});
test('batch writes keep selection revisions, continue after conflicts and report each failure',async()=>{
 const songs=[{id:'one',revision:3,title:'One'},{id:'two',revision:4,title:'Two'},{id:'three',revision:5,title:'Three'}] as Song[];
 const sent:[string,number][]=[],progress:number[]=[];
 const result=await runLibraryBatch(songs,async song=>{sent.push([song.id,song.revision]);if(song.id==='two')throw Error('409 version conflict');return {...song,revision:song.revision+1};},done=>progress.push(done));
 assert.deepEqual(sent,[['one',3],['two',4],['three',5]]);assert.deepEqual(progress,[1,2,3]);
 assert.deepEqual(result.succeeded.map(s=>s.id),['one','three']);assert.equal(result.failed[0].song,songs[1]);assert.match(result.failed[0].message,/409/);assert.equal(songs[0].revision,3);
});
