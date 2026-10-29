import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Note} from './types.ts';
import {bindStaffFragments,staffPlaybackAtBeat,staffCompatibleMusicXml} from './staff-playback.ts';

test('legacy sound-only tempo directions become renderable without changing notes or an existing visual direction',()=>{
  const legacy='<measure><direction><sound tempo="87.5"/></direction><note id="n"><duration>480</duration></note></measure>';
  const compatible=staffCompatibleMusicXml(legacy);
  assert.ok(compatible.includes('<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>87.5</per-minute></metronome></direction-type>'));
  assert.ok(compatible.endsWith('<note id="n"><duration>480</duration></note></measure>'));
  assert.ok(compatible.includes('<sound tempo="87.5"/>'));
  assert.equal(staffCompatibleMusicXml(compatible),compatible);
  const visual='<direction><direction-type><words>Andante</words></direction-type><sound tempo="87.5"/></direction>';
  assert.equal(staffCompatibleMusicXml(visual),visual);
});
test('two-line lyric text becomes numbered MusicXML verses without double-escaping text or inventing events',()=>{
 const xml='<note><duration>480</duration><lyric><text>Hello &amp;\n哈喽</text></lyric></note><note><lyric><text>\n第二行</text></lyric></note>';
 const output=staffCompatibleMusicXml(xml);
 assert.ok(output.includes('<lyric number="1"><text>Hello &amp;</text></lyric><lyric number="2"><text>哈喽</text></lyric>'));
 assert.ok(output.includes('<lyric number="1"><text></text></lyric><lyric number="2"><text>第二行</text></lyric>'));
 assert.equal((output.match(/<note>/g)||[]).length,2);assert.equal(staffCompatibleMusicXml(output),output);
});

const notes:Note[]=[
  {id:'tied',beat:1,duration:5,midi:60,lyric:'长',phraseId:'p'},
  {id:'rest',beat:6,duration:1,midi:null,lyric:'',phraseId:'p'},
  {id:'next',beat:8,duration:1,midi:64,lyric:'音',phraseId:'p'},
];
const fragments=[
  {beat:0,duration:1,graphic:'leading silence'},
  {beat:1,duration:3,graphic:'tie start and lyric'},
  {beat:4,duration:2,graphic:'tie continuation'},
  {beat:6,duration:1,graphic:'explicit rest'},
  {beat:7,duration:1,graphic:'inserted silence'},
  {beat:8,duration:1,graphic:'next note'},
];
test('staff fragments map each tied continuation to the complete source event; generated gaps stay unbound',()=>{
  assert.deepEqual(bindStaffFragments(notes,fragments).map(b=>[b.graphic,b.noteId]),[
    ['tie start and lyric','tied'],['tie continuation','tied'],['explicit rest','rest'],['next note','next'],
  ]);
});
test('playback colors every tied fragment and lyric while following the current fragment',()=>{
  const bindings=bindStaffFragments(notes,fragments);
  const state=staffPlaybackAtBeat(notes,bindings,4.5);
  assert.deepEqual(state.active.map(b=>b.graphic),['tie start and lyric','tie continuation']);
  assert.equal(state.current?.graphic,'tie continuation');
});
test('seeks, exact end boundaries and gaps clear previous highlight without holding the last note',()=>{
  const bindings=bindStaffFragments(notes,fragments);
  for(const [beat,activeId,current] of [[8,'next','next note'],[1,'tied','tie start and lyric'],[6,'rest','explicit rest'],[7,undefined,undefined],[9,undefined,undefined],[-1,undefined,undefined]] as const){
    const state=staffPlaybackAtBeat(notes,bindings,beat);
    assert.equal(state.active[0]?.noteId,activeId,`beat ${beat}`);
    assert.equal(state.current?.graphic,current,`follow beat ${beat}`);
  }
});
