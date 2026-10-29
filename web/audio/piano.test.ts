import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPianoSamples,nearestSample} from './piano';
import {pianoVoice,renderPiano,renderTake} from './engine';

test('local sampled piano is decoded once per context and reused by concurrent requests',async()=>{
  let reads=0,decodes=0;
  const context={decodeAudioData:async()=>{decodes++;return {duration:3} as AudioBuffer;}} as unknown as BaseAudioContext;
  const request=async(url:string|URL|Request)=>{reads++;return String(url).endsWith('manifest.json')?new Response(JSON.stringify({name:'Fixture Grand',license:'CC BY 3.0',attribution:'Fixture artist',samples:{48:'/piano/C3.mp3',60:'/piano/C4.mp3'}}),{headers:{'Content-Type':'application/json'}}):new Response(new Uint8Array([1,2,3]));};
  const [first,second]=await Promise.all([loadPianoSamples(context,request),loadPianoSamples(context,request)]);
  assert.equal(first,second);assert.equal(first.state,'sampled');assert.equal(first.samples.size,2);assert.equal(reads,3);assert.equal(decodes,2);
});
test('missing or corrupt local samples yield a truthful synthesis fallback',async()=>{
  const context={decodeAudioData:async()=>{throw new Error('Invalid MP3');}} as unknown as BaseAudioContext;
  const bank=await loadPianoSamples(context,async url=>String(url).endsWith('manifest.json')?new Response(JSON.stringify({name:'Grand',samples:{60:'/piano/C4.mp3'}})):new Response(new Uint8Array([0])));
  assert.equal(bank.state,'synthesized');assert.equal(bank.samples.size,0);
});
test('sample pitch uses the closest recorded key and transposes by equal tempered semitones',()=>{
  const bank=new Map([[48,{} as AudioBuffer],[60,{} as AudioBuffer],[72,{} as AudioBuffer]]);
  assert.deepEqual(nearestSample(bank,58),{root:60,buffer:bank.get(60),rate:Math.pow(2,-2/12)});
  assert.equal(nearestSample(bank,54)?.root,48);assert.equal(nearestSample(bank,72)?.rate,1);assert.equal(nearestSample(new Map(),60),null);
});
function audioFixture(){
  const sources:{buffer:AudioBuffer|null;playbackRate:{value:number};startAt:number;stopAt:number;connect:()=>void;disconnect:()=>void;start:(at:number)=>void;stop:(at:number)=>void;onended:(()=>void)|null}[]=[];
  const context={sampleRate:44100,destination:{},createGain:()=>({gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}),createBufferSource:()=>{const node={buffer:null as AudioBuffer|null,playbackRate:{value:1},startAt:-1,stopAt:-1,onended:null as (()=>void)|null,connect(){},disconnect(){},start(at:number){this.startAt=at;},stop(at:number){this.stopAt=at;}};sources.push(node);return node;}};
  return {context:context as unknown as BaseAudioContext,sources};
}
test('live piano schedules the decoded sample with its pitch ratio and note release',()=>{
  const {context,sources}=audioFixture(),buffer={duration:4} as AudioBuffer;
  pianoVoice(context,context.destination,72,1,.5,.3,new Map([[60,buffer]]));
  assert.equal(sources.length,1);assert.equal(sources[0].buffer,buffer);assert.equal(sources[0].playbackRate.value,2);assert.equal(sources[0].startAt,1);assert.ok(sources[0].stopAt>1.5&&sources[0].stopAt<1.8);
});
test('WAV export and take mix schedule the same decoded sample bank as live piano',async()=>{
  const rendered:ReturnType<typeof audioFixture>[]=[];
  globalThis.OfflineAudioContext=class {constructor(){const fixture=audioFixture();rendered.push(fixture);Object.assign(this,fixture.context);}async startRendering(){return {sampleRate:44100,getChannelData:()=>new Float32Array(44)};}} as unknown as typeof OfflineAudioContext;
  const buffer={duration:4} as AudioBuffer,bank=new Map([[60,buffer]]),score={bpm:120,key:'C',timeSignature:[4,4] as [number,number],status:'reviewed',phrases:[],notes:[{id:'n',beat:0,duration:1,midi:60,phraseId:'',lyric:''}]};
  await renderPiano(score,1,12,bank);
  await renderTake(new ArrayBuffer(8),score,[{at:0,beat:0,state:'playing',rate:2,transpose:12}],{decodeAudioData:async()=>({duration:1})} as unknown as AudioContext,undefined,bank);
  assert.equal(rendered.length,2);for(const fixture of rendered){const piano=fixture.sources.find(source=>source.buffer===buffer);assert.ok(piano);assert.equal(piano.playbackRate.value,2);}
});
