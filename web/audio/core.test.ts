import test from 'node:test';
import assert from 'node:assert/strict';
import { beatToAudio, audioToBeat, loopPosition, detectPitch, midiFromHz, encodeWav, takePosition, takeNotes } from './core';

test('positive offset maps score start later, and inverse preserves negative pre-roll', () => {
  assert.equal(beatToAudio(4,120,{offset:2,anchors:[]}),4);
  assert.equal(audioToBeat(1,120,{offset:2,anchors:[]}),-2);
});
test('piecewise anchors invert each segment and extrapolate edge slopes', () => {
  const a={offset:99,anchors:[{beat:0,seconds:2},{beat:4,seconds:5},{beat:8,seconds:7}]};
  assert.equal(beatToAudio(6,120,a),6);
  assert.equal(audioToBeat(6,120,a),6);
  assert.equal(beatToAudio(10,120,a),8);
  assert.throws(()=>beatToAudio(0,120,{offset:0,anchors:[{beat:0,seconds:3},{beat:1,seconds:2}]}));
});
test('loop is half open and gap is real seconds, independent of tempo multiplier', () => {
  assert.deepEqual(loopPosition(2,0,4,120,1,1),{beat:4,gap:true,cycle:0});
  assert.deepEqual(loopPosition(3,0,4,120,1,1),{beat:0,gap:false,cycle:1});
  assert.deepEqual(loopPosition(4.5,0,4,120,0.5,1),{beat:4,gap:true,cycle:0});
  assert.deepEqual(loopPosition(5,0,4,120,0.5,1),{beat:0,gap:false,cycle:1});
});
test('pitch detects fixed sine and harmonic-rich low tone, blanks silence and gated signals', () => {
  for(const hz of [110,220,440,880]) {
    const frame=Float32Array.from({length:4096},(_,i)=>0.35*Math.sin(2*Math.PI*hz*i/48000)+0.1*Math.sin(4*Math.PI*hz*i/48000));
    const result=detectPitch(frame,48000,{minHz:70,maxHz:1100,gateDb:-55,confidence:0.8});
    assert.ok(result.hz!==null && Math.abs(result.hz-hz)<2,`${hz}: ${result.hz}`);
  }
  assert.equal(detectPitch(new Float32Array(4096),48000).hz,null);
  assert.equal(midiFromHz(440),69);
});
test('WAV writes signed PCM and correct RIFF sizes',()=>{
  const bytes=encodeWav([new Float32Array([-1,0,1])],48000);
  const view=new DataView(bytes);
  assert.equal(view.getUint32(24,true),48000);
  assert.equal(view.getUint32(40,true),6);
  assert.equal(view.getInt16(44,true),-32768);
  assert.equal(view.getInt16(48,true),32767);
});
test('take replay uses each event rate and freezes through pause and loop gap',()=>{
  const events=[{at:0,beat:0,state:'playing',rate:2},{at:2,beat:4,state:'paused',rate:2},{at:3,beat:8,state:'playing',rate:1}];
  assert.equal(takePosition(events,1),2);
  assert.equal(takePosition(events,2.5),4);
  assert.equal(takePosition(events,5),10);
});
test('take accompaniment clips at pause and replays seeks with each segment transposition',()=>{
  const notes=[{beat:0,duration:4,midi:60},{beat:4,duration:1,midi:62}];
  const events=[{at:0,beat:0,state:'playing',rate:2,transpose:0},{at:1,beat:2,state:'paused',rate:2},{at:2,beat:0,state:'playing',rate:1,transpose:12},{at:3,beat:1,state:'paused',rate:1}];
  assert.deepEqual(takeNotes(notes,events,4),[{at:0,duration:1,midi:60},{at:2,duration:1,midi:72}]);
});
test('original take follows piecewise audio alignment at 1x across an anchor',()=>{
  const alignment={offset:0,anchors:[{beat:0,seconds:2},{beat:4,seconds:4},{beat:8,seconds:8}]};
  const events=[{at:0,beat:2,state:'playing',rate:2,mode:'original',audioSeconds:3,transpose:0}];
  assert.equal(takePosition(events,2,alignment,120),5);
  assert.deepEqual(takeNotes([{beat:4,duration:2,midi:60}],events,5,alignment,120),[{at:1,duration:2,midi:60}]);
});
test('duplicate playing events do not re-strike a held reference note',()=>{
  assert.deepEqual(takeNotes([{beat:0,duration:4,midi:60}],[{at:0,beat:0,state:'playing',rate:1},{at:1,beat:1,state:'playing',rate:1}],3),[{at:0,duration:3,midi:60}]);
});
