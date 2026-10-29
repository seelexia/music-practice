import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as score from './score-utils.ts';
import type {Score,Note} from './types.ts';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NumberedScore} from './components/ScoreView.tsx';

const notes:Note[]=[
  {id:'a',beat:2,duration:1,midi:60,lyric:'春',phraseId:'p'},
  {id:'b',beat:4,duration:.5,midi:62,lyric:'风',phraseId:'p'},
  {id:'c',beat:6,duration:2,midi:64,lyric:'来',phraseId:'p'},
];
const sheet:Score={bpm:80,key:'C',timeSignature:[3,4],notes,phrases:[{id:'p',label:'第一句'}],status:'draft'};

test('human pitch entry accepts numbered notes and solfege aliases in the selected key',()=>{
  assert.deepEqual(score.parseHumanPitch('so','D',1,-1),{midi:80,degree:5,octave:1});
  assert.deepEqual(score.parseHumanPitch('xi','C',-1,0),{midi:59,degree:7,octave:-1});
  assert.deepEqual(score.parseHumanPitch('♯4','C',0,0),{midi:66,degree:4,octave:0});
  assert.deepEqual(score.parseHumanPitch('0','C',0,0),{midi:null,degree:0,octave:0});
  assert.throws(()=>score.parseHumanPitch('8','C',0,0),/1–7|唱名/);
});
test('duration correction shifts later notes by its delta and preserves lead-in and intentional gaps',()=>{
  const changed=score.updateScoreNote(notes,0,{duration:2});
  assert.deepEqual(changed.map(n=>n.beat),[2,5,7]);
  assert.deepEqual(score.updateScoreNote(changed,0,{duration:.5}).map(n=>n.beat),[2,3.5,5.5]);
  assert.deepEqual(notes.map(n=>n.beat),[2,4,6]);
});
test('insert and delete close only occupied note time while retaining intentional gaps',()=>{
  const created={...notes[0],id:'new',duration:.5,lyric:''};
  const added=score.insertScoreNote(notes,1,created);
  assert.deepEqual(added.map(n=>[n.id,n.beat]),[['a',2],['new',4],['b',4.5],['c',6.5]]);
  assert.deepEqual(score.deleteScoreNote(added,1),notes);
  assert.deepEqual(score.deleteScoreNote(notes,0).map(n=>n.beat),[3,5]);
  assert.equal(score.insertScoreNote(notes,3,created)[3].beat,8);
});
test('note playback starts the configured lead-in before the exact note and clamps at score start',()=>{
  assert.equal(score.notePlaybackStart(sheet,4.2),3);
  assert.equal(score.notePlaybackStart(sheet,6,2),4);
  assert.equal(score.notePlaybackStart(sheet,2,8),0);
  assert.equal(score.notePlaybackStart(sheet,5),null);
});
test('two note loop selection includes the full last note in either click direction',()=>{
  assert.deepEqual(score.noteLoopRange(notes,'a','c'),{start:2,end:8});
  assert.deepEqual(score.noteLoopRange(notes,'c','a'),{start:2,end:8});
  assert.deepEqual(score.noteLoopRange(notes,'b','b'),{start:4,end:4.5});
  assert.equal(score.noteLoopRange(notes,'a','missing'),null);
});
test('measure layout follows meter, keeps gaps, and splits sustained notes across barlines',()=>{
  const measures=score.layoutScoreMeasures({...sheet,notes:[{...notes[0],beat:2,duration:5},{...notes[1],beat:8,duration:1}]});
  assert.deepEqual(measures.map(m=>[m.index,m.start,m.duration]),[[0,0,3],[1,3,3],[2,6,3]]);
  assert.deepEqual(measures.flatMap(m=>m.segments).filter(s=>s.noteId==='a').map(s=>[s.beat,s.duration,s.continuation]),[[2,1,false],[3,3,true],[6,1,true]]);
  assert.equal(measures[0].segments[0].noteId,null);
  assert.equal(measures[0].segments[0].duration,2);
  assert.equal(score.layoutScoreMeasures({...sheet,timeSignature:[6,8]})[0].duration,3);
});
test('playback highlights only the sounding measure segment of a note crossing barlines',()=>{
  const markup=renderToStaticMarkup(createElement(NumberedScore,{score:{...sheet,notes:[{...notes[0],beat:0,duration:8}]},beat:4}));
  const segments=[...markup.matchAll(/data-note-id="a"[^>]*class="([^"]*)"/g)].map(match=>match[1].split(' ').includes('active'));
  assert.deepEqual(segments,[false,true,false]);
});
test('printed measure metadata preserves a pickup and unequal bar lengths without rescaling notes',()=>{
  const printed={...sheet,notes:[{...notes[0],beat:0,duration:1,measureId:'pickup'},{...notes[1],beat:1,duration:4,measureId:'bar'}],measures:[{id:'pickup',startBeat:0,duration:1,pickup:true},{id:'bar',startBeat:1,duration:4,expectedBeats:3}]};
  assert.deepEqual(score.layoutScoreMeasures(printed).map(m=>[m.start,m.duration]),[[0,1],[1,4]]);
  assert.deepEqual(printed.notes.map(n=>[n.beat,n.duration]),[[0,1],[1,4]]);
  assert.deepEqual(score.layoutScoreMeasures({...printed,notes:[{...printed.notes[0],duration:2},printed.notes[1]]}).map(m=>[m.start,m.duration]),[[0,3],[3,3]]);
});
test('timing invalidation removes stale measure references and preserves all other score data',()=>{
  const printed={...sheet,notes:notes.map(n=>({...n,measureId:'m'})),measures:[{id:'m',startBeat:0,duration:8}],customProvenance:'preserved'};
  const cleaned=score.withoutScoreMeasures(printed);
  assert.equal(cleaned.measures,undefined);
  assert.ok(cleaned.notes.every(n=>n.measureId===undefined));
  assert.equal((cleaned as typeof printed).customProvenance,'preserved');
  assert.equal(printed.notes[0].measureId,'m');
});
