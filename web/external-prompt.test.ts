import {test} from 'node:test';
import assert from 'node:assert/strict';
import {externalTranscriptionPrompt,externalTranscriptionExample} from './external-prompt.ts';
test('external delivery prompt retains authoritative schema/context and requires an importable file',()=>{
 const base='BASE_SCHEMA_AND_PAGE_MANIFEST';const text=externalTranscriptionPrompt(base);
 assert.ok(text.startsWith(base));for(const marker of ['score.shengjian.score.json','UTF-8','sourceId/phraseId/tieFrom','不是秒','degree=null','JSON Schema','不修改音符去凑拍'])assert.ok(text.includes(marker),marker);
 assert.equal(externalTranscriptionPrompt(base+'\n'),text);
});
test('copy rules define two aligned LF-separated rows with alternate verse, translation and phonetic examples',()=>{
 const prompt=externalTranscriptionPrompt('BASE');
 for(const marker of ['双行歌词','第一行\\n第二行','第二遍','翻译','空耳','不增加音符','provenance.lyricRows','1000'])assert.ok(prompt.includes(marker),marker);
 assert.match(prompt,/Hello\\n哈喽/);
});
test('download example adds actual newline lyrics while keeping v1 structure and leaving API template untouched',()=>{
 const template={format:'shengjian.score',version:1,provenance:{producer:'Example'},measures:[{notes:['清','风','来','了'].map(lyric=>({lyric,degree:1,duration:[1,1]}))}]};
 const example=externalTranscriptionExample(template);
 assert.deepEqual(example.measures[0].notes.map(note=>note.lyric),['清\n微','风\n雨','来\n停','了\n了']);
 assert.deepEqual(template.measures[0].notes.map(note=>note.lyric),['清','风','来','了']);
 assert.equal(example.version,1);assert.deepEqual(example.measures[0].notes[0].duration,[1,1]);
 assert.deepEqual(example.provenance.lyricRows,{first:'第一遍歌词',second:'第二遍歌词',kind:'alternateVerse'});
 assert.deepEqual(externalTranscriptionExample(example),example);
});
