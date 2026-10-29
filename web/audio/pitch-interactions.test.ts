import test from 'node:test';
import assert from 'node:assert/strict';
import {pointerPitch,zoomPitchRange,approximatePitchNotes,type PitchPoint} from './pitch-interactions';
import * as interactions from './pitch-interactions';

const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const frame=(at:number,midi:number|null,beat=at*2):PitchPoint=>({at,midi,beat,raw:midi});

test('live timeline centers the latest time even at zero and retains a dragged anchor as time advances',()=>{
 const timeline=(interactions as Record<string,unknown>).pitchTimeline as (cursor:number,span:number,live:boolean,ratio?:number)=>{start:number;end:number;cursorRatio:number};
 assert.equal(typeof timeline,'function');
 assert.deepEqual(timeline(0,12,true),{start:-6,end:6,cursorRatio:.5});
 assert.deepEqual(timeline(120,12,true),{start:114,end:126,cursorRatio:.5});
 const first=timeline(120,12,true,.7),next=timeline(121,12,true,.7);
 near(first.start,111.6);near(next.start,112.6);near(first.cursorRatio,.7);near(next.cursorRatio,.7);
 near(timeline(2,12,true,9).cursorRatio,.9);near(timeline(2,12,true,-9).cursorRatio,.1);
 // Existing song-playback framing is not a live cursor-drag operation.
 assert.deepEqual(timeline(0,12,false,.9),{start:0,end:12,cursorRatio:0});
 near(timeline(120,12,false,.9).start,115.8);
});

test('dragging the latest-time line uses plot width excluding the pitch-name axis',()=>{
 const ratio=(interactions as Record<string,unknown>).pitchCursorRatio as (x:number,width:number)=>number;
 assert.equal(typeof ratio,'function');near(ratio(48+(1000-48)*.5,1000),.5);near(ratio(48+(1000-48)*.75,1000),.75);
 assert.equal(ratio(-50,1000),.1);assert.equal(ratio(2000,1000),.9);assert.equal(ratio(0,48),.5);
});

test('local plot resize keeps both dimensions usable and never exceeds its parent width',()=>{
 const size=(interactions as Record<string,unknown>).pitchPlotSize as (width:number,height:number,available:number,viewportHeight:number)=>{width:number;height:number};
 assert.equal(typeof size,'function');assert.deepEqual(size(500,420,900,700),{width:500,height:420});
 assert.deepEqual(size(20,20,900,700),{width:260,height:220});assert.deepEqual(size(2000,3000,900,700),{width:900,height:1400});
 assert.deepEqual(size(300,400,190,700),{width:190,height:400});
});

test('labels-above headroom shares pointer and wheel coordinates with the rendered plot',()=>{
 const pointer=pointerPitch as (range:[number,number],y:number,height:number,top?:number,bottom?:number)=>number;
 const zoom=zoomPitchRange as (range:[number,number],y:number,height:number,delta:number,top?:number,bottom?:number)=>[number,number];
 const range:[number,number]=[48,84];near(pointer(range,32,320,32,16),84);near(pointer(range,304,320,32,16),48);near(pointer(range,168,320,32,16),66);
 const anchor=pointer(range,100,320,32,16),changed=zoom(range,100,320,-120,32,16);near(pointer(changed,100,320,32,16),anchor);
});

test('reference target uses the sounding shifted MIDI and half-open event boundaries',()=>{
  const active=(interactions as Record<string,unknown>).activeReferenceMidi as typeof import('./pitch-interactions')['activeReferenceMidi'];
  assert.equal(typeof active,'function','reference target helper exists');
  const notes=[{beat:0,duration:1,midi:60},{beat:1,duration:1,midi:61},{beat:2,duration:1,midi:null},{beat:4,duration:1,midi:67}];
  assert.equal(active(notes,.5,2),62);
  assert.equal(active(notes,1,2),63);
  for(const beat of [-1,2,3,5,NaN])assert.equal(active(notes,beat,2),null);
  for(const flags of [{showReference:false},{live:true},{referenceActive:false}])assert.equal(active(notes,.5,2,flags),null);
  assert.equal(active([{beat:0,duration:1,midi:127}],.5,1),null);
});

test('current reference remains on the axis when accidental filtering or sparse labels skip it',()=>{
  const axis=(interactions as Record<string,unknown>).pitchAxisNotes as typeof import('./pitch-interactions')['pitchAxisNotes'];
  assert.equal(typeof axis,'function','shared axis calculation exists');
  assert.deepEqual(axis([60,72],false,6,61),[60,61,72]);
  assert.deepEqual(axis([60,72],true,6,65),[60,65,66,72]);
  assert.deepEqual(axis([60,72],false,6,null),[60,72]);
  assert.deepEqual(axis([60.5,71.5],false,6,60),[]);
  assert.deepEqual(axis([60,72],true,6,73),[60,66,72]);
});

test('movable do follows score key and whole-tune transpose across octaves',()=>{
  const solfege=(interactions as Record<string,unknown>).pitchSolfege as typeof import('./pitch-interactions')['pitchSolfege'];
  assert.equal(typeof solfege,'function','shared solfege calculation exists');
  for(const [midi,key,shift,want] of [[60,'C',0,'do'],[62,'C',0,'re'],[64,'C',0,'mi'],[65,'C',0,'fa'],[67,'C',0,'sol'],[69,'C',0,'la'],[71,'C',0,'si'],[72,'C',0,'do'],[55,'G',0,'do'],[62,'G',0,'sol'],[66,'G',0,'si'],[63,'1=E♭',0,'do'],[73,'D major',-1,'do'],[61,'C',1,'do'],[75,'C',1,'re'],[66,'F# minor',0,'do']] as const){
    assert.equal(solfege(midi,key,shift),want,`${midi} / ${key} / ${shift}`);
  }
});

test('solfege keeps chromatic pitch and only uses a source degree when its accidental fits',()=>{
  const solfege=(interactions as Record<string,unknown>).pitchSolfege as typeof import('./pitch-interactions')['pitchSolfege'];
  assert.equal(typeof solfege,'function','shared solfege calculation exists');
  assert.equal(solfege(61,'C',0),'♯do');
  assert.equal(solfege(63,'C',0,3),'♭mi');
  assert.equal(solfege(66,'C',0,4),'♯fa');
  assert.equal(solfege(68,'D',2,3),'mi');
  assert.equal(solfege(61,'C',0,5),'♯do','stale degree must not relabel a different pitch');
  assert.equal(solfege(60.9),'♯do','human boxes use nearest semitone');
  assert.equal(solfege(NaN),'');
});

test('natural grid excludes only accidental guide pitches across octave and fractional edges',()=>{
  const grid=(interactions as Record<string,unknown>).pitchGridNotes as ((range:[number,number],semitones:boolean)=>number[])|undefined;
  assert.equal(typeof grid,'function','shared pitch grid calculation exists');
  assert.deepEqual(grid!([59.5,72.2],false),[60,62,64,65,67,69,71,72]);
  assert.deepEqual(grid!([60,65],true),[60,61,62,63,64,65]);
  assert.deepEqual(grid!([0,6],false),[0,2,4,5]);
  assert.deepEqual(grid!([123,127],false),[124,125,127]);
});

test('vertical pan preserves fractional span while clamping at both MIDI boundaries',()=>{
  const pan=(interactions as Record<string,unknown>).panPitchRange as ((range:[number,number],delta:number)=>[number,number])|undefined;
  assert.equal(typeof pan,'function','shared pitch pan calculation exists');
  assert.deepEqual(pan!([45.25,81.75],6),[51.25,87.75]);
  assert.deepEqual(pan!([45.25,81.75],-6),[39.25,75.75]);
  assert.deepEqual(pan!([45.25,81.75],1000),[90.5,127]);
  assert.deepEqual(pan!([45.25,81.75],-1000),[0,36.5]);
  assert.deepEqual(pan!([0,127],6),[0,127]);
  assert.deepEqual(pan!([45.25,81.75],NaN),[45.25,81.75]);
});

test('pointer pitch uses the actual padded plot and clamps outside the grid',()=>{
  near(pointerPitch([48,84],16,320),84);
  near(pointerPitch([48,84],304,320),48);
  near(pointerPitch([48,84],88,320),75);
  near(pointerPitch([48,84],-100,320),84);
  near(pointerPitch([48,84],1000,320),48);
});

test('both wheel directions keep the pitch under the cursor fixed away from range limits',()=>{
  const initial:[number,number]=[40,90],y=100,height=400,anchor=pointerPitch(initial,y,height);
  const inside=zoomPitchRange(initial,y,height,-120),outside=zoomPitchRange(initial,y,height,120);
  assert.ok(inside[1]-inside[0]<50);
  assert.ok(outside[1]-outside[0]>50);
  near(pointerPitch(inside,y,height),anchor);
  near(pointerPitch(outside,y,height),anchor);
});

test('zoom span and boundaries stay useful under repeated or extreme wheel input',()=>{
  let range:[number,number]=[45,81];
  for(let i=0;i<100;i++)range=zoomPitchRange(range,160,320,-Number.MAX_VALUE);
  near(range[1]-range[0],6);
  for(let i=0;i<100;i++)range=zoomPitchRange(range,50,320,Number.MAX_VALUE);
  near(range[0],0);near(range[1],127);
  assert.deepEqual(zoomPitchRange([0,6],16,320,-120),[0,6]);
  const lower=zoomPitchRange([0,20],304,320,120);
  assert.equal(lower[0],0);assert.ok(lower[1]<=127);
});

test('zero or invalid wheel events leave caller range unchanged',()=>{
  const initial:[number,number]=[48,84];
  for(const [y,height,delta] of [[100,320,0],[NaN,320,120],[100,Infinity,120],[100,32,120],[100,320,NaN]]){
    assert.deepEqual(zoomPitchRange(initial,y,height,delta),initial);
  }
  assert.deepEqual(initial,[48,84]);
});

test('stable voiced frames become nearest-semitone boxes with no extension beyond captured frames',()=>{
  const notes=approximatePitchNotes([frame(0,60.1),frame(.04,59.9),frame(.08,60.2),frame(.12,62),frame(.16,62.1),frame(.2,61.9)],true);
  assert.deepEqual(notes,[{midi:60,start:0,end:.08,startAt:0,endAt:.08},{midi:62,start:.12,end:.2,startAt:.12,endAt:.2}]);
  assert.deepEqual(approximatePitchNotes([frame(0,60),frame(.04,60)],true),[]);
  assert.deepEqual(approximatePitchNotes([frame(0,60),frame(.01,60),frame(.02,60)],true),[]);
});

test('silence and capture gaps split otherwise identical note boxes',()=>{
  const input=[frame(0,60),frame(.04,60),frame(.08,60),frame(.12,null),frame(.16,60),frame(.2,60),frame(.24,60),frame(.6,60),frame(.64,60),frame(.68,60)];
  const notes=approximatePitchNotes(input,true);
  assert.equal(notes.length,3);
  assert.deepEqual(notes.map(n=>[n.start,n.end]),[[0,.08],[.16,.24],[.6,.68]]);
});

test('song loops, seeks and backwards capture timestamps never connect boxes',()=>{
  const input=[frame(0,60,6),frame(.04,60,6.08),frame(.08,60,6.16),frame(.12,60,0),frame(.16,60,.08),frame(.2,60,.16),frame(.24,60,30),frame(.28,60,30.08),frame(.32,60,30.16)];
  assert.deepEqual(approximatePitchNotes(input,false).map(n=>[n.start,n.end]),[[6,6.16],[0,.16],[30,30.16]]);
  assert.equal(approximatePitchNotes([frame(0,60),frame(.04,60),frame(.08,60),frame(0,60),frame(.04,60),frame(.08,60)],true).length,2);
});

test('fast continuous playback stays one box and invalid pitch frames break a box',()=>{
  const fast=[frame(0,60,0),frame(.04,60,.8),frame(.08,60,1.6),frame(.12,60,2.4)];
  assert.equal(approximatePitchNotes(fast,false).length,1);
  assert.equal(approximatePitchNotes([...fast,frame(.16,Infinity,3.2),frame(.2,60,4),frame(.24,60,4.8),frame(.28,60,5.6)],false).length,2);
});

test('explicit capture continuity breaks even a small forward seek at the same sung pitch',()=>{
  const input=[frame(0,60,0),frame(.04,60,.08),frame(.08,60,.16),frame(.12,60,.66),frame(.16,60,.74),frame(.2,60,.82)].map((point,index)=>({...point,continuityId:index<3?1:2}));
  assert.deepEqual(approximatePitchNotes(input,false).map(note=>[note.start,note.end]),[[0,.16],[.66,.82]]);
});
