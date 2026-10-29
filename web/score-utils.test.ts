import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renumberNotes, moveNote, selectedMetadata, parseScoreDraft, scoreNoteAtBeat, updateScoreNote,numberedNote,playScorePhraseAtBeat,scoreSource,numberedRhythm,transposeScoreKey,parseHumanPitch} from './score-utils.ts';

const notes = [
  {id:'a',beat:0,duration:1.5,midi:60,lyric:'春',phraseId:'p'},
  {id:'b',beat:1.5,duration:.5,midi:62,lyric:'风',phraseId:'p'},
  {id:'c',beat:2,duration:2,midi:null,lyric:'',phraseId:'p'},
];
test('unknown pitch stays explicit through human editing and irregular rhythm is visible',()=>{
 assert.deepEqual(parseHumanPitch('?','C'),{midi:null,degree:null,octave:0});
 assert.deepEqual(numberedRhythm(15/8),{underlines:0,dots:3,extension:''});
 assert.equal(numberedRhythm(2/3).fraction,'2/3 拍');
});
test('numbered rhythm distinguishes sixteenth notes, augmentation dots and sustained beats',()=>{
 assert.deepEqual(numberedRhythm(.25),{underlines:2,dots:0,extension:''});
 assert.deepEqual(numberedRhythm(.125),{underlines:3,dots:0,extension:''});
 assert.deepEqual(numberedRhythm(.75),{underlines:1,dots:1,extension:''});
 assert.deepEqual(numberedRhythm(1.5),{underlines:0,dots:1,extension:''});
 assert.deepEqual(numberedRhythm(3),{underlines:0,dots:0,extension:'––'});
});
test('correcting the numbered key preserves degrees and rhythm while changing actual pitches',()=>{
 const score={bpm:80,key:'C',timeSignature:[4,4] as [number,number],notes,phrases:[{id:'p',label:'句'}],status:'review'};
 const changed=transposeScoreKey(score,'Bb');assert.equal(changed.key,'Bb');assert.equal(changed.notes[0].midi,58);assert.equal(changed.notes[1].midi,60);assert.equal(changed.notes[2].midi,null);assert.equal(changed.notes[1].beat,1.5);assert.equal(score.notes[0].midi,60);
 assert.throws(()=>transposeScoreKey({...score,notes:[{...notes[0],midi:0}]},'A'));
});
test('reordering preserves note identity and uses durations to rebuild beats without mutating source',()=>{
  const moved = moveNote(notes,2,-1);
  assert.deepEqual(moved.map(n=>[n.id,n.beat]),[['a',0],['c',1.5],['b',3.5]]);
  assert.equal(notes[1].id,'b');
});
test('deletion closes the time gap and invalid durations are rejected',()=>{
  assert.deepEqual(renumberNotes([notes[0],notes[2]]).map(n=>n.beat),[0,1.5]);
  assert.throws(()=>renumberNotes([{...notes[0],duration:0}]),/时值/);
  assert.throws(()=>renumberNotes([{...notes[0],duration:NaN}]),/时值/);
});
test('pitch, lyric, phrase and review edits preserve the original onsets and gaps',()=>{
  const timed=[{...notes[0],beat:2},{...notes[1],beat:5}];
  for(const change of [{midi:65},{lyric:'雨'},{phraseId:'q'},{uncertain:false}]){
    const edited=updateScoreNote(timed,0,change);
    assert.deepEqual(edited.map(n=>n.beat),[2,5]);
    assert.deepEqual(edited[0],{...timed[0],...change});
    assert.equal(timed[0].midi,60);
  }
});
test('duration edits still rebuild contiguous onsets from the edited durations',()=>{
  assert.deepEqual(updateScoreNote(notes,0,{duration:2}).map(n=>n.beat),[0,2,2.5]);
  assert.throws(()=>updateScoreNote(notes,0,{duration:0}),/时值/);
});
test('metadata application includes only explicitly selected fields, never URLs or unknown fields',()=>{
  assert.deepEqual(selectedMetadata({title:'新歌',artist:'歌手',coverUrl:'https://x',platform:'qq'},['title','coverUrl']),{title:'新歌'});
});
test('draft import validates pitches and phrase references before replacing local editor state',()=>{
  const score={bpm:80,key:'C',timeSignature:[4,4],notes,phrases:[{id:'p',label:'第一句'}],status:'draft'};
  assert.equal(parseScoreDraft(JSON.stringify(score)).notes[2].midi,null);
  assert.throws(()=>parseScoreDraft(JSON.stringify({...score,notes:[{...notes[0],midi:128}]})),/MIDI/);
  assert.throws(()=>parseScoreDraft(JSON.stringify({...score,phrases:[]})),/乐句/);
});
test('monophonic draft import rejects overlapping notes while preserving valid timing gaps',()=>{
  const score={bpm:80,key:'C',timeSignature:[4,4],notes:[{...notes[0],beat:2},{...notes[1],beat:5}],phrases:[{id:'p',label:'第一句'}],status:'draft'};
  assert.deepEqual(parseScoreDraft(JSON.stringify(score)).notes.map(n=>n.beat),[2,5]);
  assert.throws(()=>parseScoreDraft(JSON.stringify({...score,notes:[notes[0],{...notes[1],beat:1}]})),/单声部|重叠/);
  assert.throws(()=>parseScoreDraft(JSON.stringify({...score,notes:[notes[0],{...notes[1],beat:0}]})),/单声部|重叠/);
});
test('staff split tied note maps to original note while a boundary maps to the following note',()=>{
  assert.equal(scoreNoteAtBeat(notes,1)?.id,'a');
  assert.equal(scoreNoteAtBeat(notes,1.5)?.id,'b');
  assert.equal(scoreNoteAtBeat(notes,3)?.id,'c');
  assert.equal(scoreNoteAtBeat(notes,4),undefined);
});
test('numbered score preserves the undotted playback register used by recognition for each key',()=>{
  for(const [key,midi] of [['C',60],['D',62],['Eb',63],['F#',66],['Gb',66],['G',55],['A',57],['Bb',58],['B',59]] as const){
    assert.deepEqual(numberedNote({...notes[0],midi},key),{number:'1',octave:0});
    assert.deepEqual(numberedNote({...notes[0],midi:midi+12},key),{number:'1',octave:1});
    assert.deepEqual(numberedNote({...notes[0],midi:midi-12},key),{number:'1',octave:-1});
  }
  assert.deepEqual(numberedNote({...notes[0],midi:58},'1=B♭'),{number:'1',octave:0});
});
test('score clicks start the entire owning phrase including a tied continuation, and ignore gaps',()=>{
  const score={bpm:80,key:'C',timeSignature:[4,4] as [number,number],notes:[{...notes[0],phraseId:'first'},{...notes[1],phraseId:'second'}],phrases:[{id:'first',label:'前句'},{id:'second',label:'后句'}],status:'reviewed'};
  const played:string[]=[];const practice={seekPhrase:(id:string)=>played.push(id)};
  playScorePhraseAtBeat(score,1,practice);
  playScorePhraseAtBeat(score,1.5,practice);
  playScorePhraseAtBeat(score,4,practice);
  playScorePhraseAtBeat(score,0,null);
  assert.deepEqual(played,['first','second']);
});
test('note source resolves stable ids or legacy names to human-readable score page labels',()=>{
  const assets=[{id:'audio',name:'source.mp3',kind:'audio' as const},{id:'one',name:'第一张.png',kind:'score' as const},{id:'two',name:'第二张.png',kind:'score' as const}];
  assert.deepEqual(scoreSource('two',assets),{assetId:'two',label:'第 2 页 · 第二张.png'});
  assert.deepEqual(scoreSource('第一张.png',assets),{assetId:'one',label:'第 1 页 · 第一张.png'});
  assert.deepEqual(scoreSource(undefined,assets),{label:'手动录入 / 未标记来源'});
  assert.deepEqual(scoreSource('removed-page',assets),{label:'来源图片未找到'});
});
test('numbered display derives a corrected MIDI pitch even when imported degree metadata is stale',()=>{
  assert.deepEqual(numberedNote({...notes[0],midi:60,degree:1,octave:0},'Bb'),{number:'2',octave:0});
  assert.deepEqual(numberedNote({...notes[0],midi:59},'Bb'),{number:'♯1',octave:0});
  assert.deepEqual(numberedNote({...notes[0],midi:null},'Bb'),{number:'0',octave:0});
});
