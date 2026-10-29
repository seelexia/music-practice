import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {lyricRows,joinLyricRows,scoreLyricsText} from './lyrics.ts';
import {NumberedScore} from './components/ScoreView.tsx';
import NoteInspector from './components/NoteInspector.tsx';
import type {Score} from './types.ts';
const score:Score={bpm:96,key:'C',timeSignature:[4,4],status:'draft',phrases:[{id:'p',label:'示例'}],notes:[
 {id:'a',beat:0,duration:1,midi:60,lyric:'清\nGentle ',phraseId:'p'},
 {id:'b',beat:1,duration:1,midi:62,lyric:'风',phraseId:'p'},
 {id:'c',beat:2,duration:2,midi:64,lyric:'\nbreeze',phraseId:'p'},
]};
test('lyric rows preserve empty first row, melisma gaps, word spacing and legacy extra rows',()=>{
 assert.deepEqual(lyricRows('Hello\r\n哈喽'),['Hello','哈喽']);
 assert.deepEqual(lyricRows('\nonly second'),['','only second']);
 assert.deepEqual(lyricRows(''),['']);
 assert.equal(joinLyricRows(['one','']), 'one');
 assert.equal(joinLyricRows(['','second']), '\nsecond');
 assert.equal(joinLyricRows(['Hello ','translation','legacy']), 'Hello \ntranslation\nlegacy');
 assert.throws(()=>joinLyricRows(['字'.repeat(333),'x']),/1000/);
 assert.equal(new TextEncoder().encode(joinLyricRows(['字'.repeat(332),'好'])).length,1000);
});
test('lyrics export joins by row within each phrase instead of interleaving note rows',()=>{
 assert.equal(scoreLyricsText(score),'清风\nGentle breeze');
 const single={...score,notes:score.notes.map(note=>({...note,lyric:lyricRows(note.lyric)[0]}))};
 assert.equal(scoreLyricsText(single),'清风');
});
test('numbered notes reserve aligned lyric rows including a blank upper row',()=>{
 const markup=renderToStaticMarkup(createElement(NumberedScore,{score}));
 assert.match(markup,/data-lyric-row="1"[^>]*>清/);
 assert.match(markup,/data-lyric-row="2"[^>]*>Gentle /);
 assert.match(markup,/data-lyric-row="2"[^>]*>breeze/);
 assert.equal((markup.match(/data-lyric-row="2"/g)||[]).length,3);
});
test('note editor exposes both rows as independent inputs without collapsing a stored LF',()=>{
 const markup=renderToStaticMarkup(createElement(NoteInspector,{note:score.notes[0],index:0,count:3,scoreKey:'C',phrases:score.phrases,onApply:()=>{},onMove:()=>{},onInsert:()=>{},onDelete:()=>{},onError:()=>{}}));
 assert.match(markup,/aria-label="当前音符歌词"[^>]*value="清"/);
 assert.match(markup,/aria-label="当前音符第二行歌词"[^>]*value="Gentle "/);
});
