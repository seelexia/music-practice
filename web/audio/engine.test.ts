import test from 'node:test';
import assert from 'node:assert/strict';
import {PracticeTransport,defaults} from './engine';
import type {Song} from '../types';

class FakeContext {
  currentTime=0;sampleRate=48000;destination={};state='running';
  createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
  async resume(){} async close(){}
}
class FakeAudio {
  currentTime=0;volume=1;playbackRate=1;src='';preload='';onended:(()=>void)|null=null;onerror:(()=>void)|null=null;
  playPromise:Promise<void>=Promise.resolve();
  play(){return this.playPromise;} pause(){} load(){} removeAttribute(){}
}
const song:Song={id:'fixture',revision:1,title:'Fixture',artist:'',album:'',composer:'',lyricist:'',description:'',tags:[],links:{bilibili:'',qq:'',netease:''},coverId:null,assets:[{id:'audio',kind:'audio',name:'audio.wav',mime:'audio/wav',size:44,url:'/fixture.wav',createdAt:''}],score:{bpm:120,key:'C',timeSignature:[4,4],notes:[{id:'rest',beat:0,duration:4,midi:null,lyric:'',phraseId:'p'}],phrases:[{id:'p',label:'Phrase'}],status:'reviewed'},alignment:{offset:2,anchors:[]},archived:false,createdAt:'',updatedAt:''};
function transport(){
  globalThis.AudioContext=FakeContext as unknown as typeof AudioContext;
  globalThis.Audio=FakeAudio as unknown as typeof Audio;
  const engine=new PracticeTransport(structuredClone(song));
  return {engine,clock:engine.context as unknown as FakeContext,media:(engine as unknown as {media:FakeAudio}).media};
}

test('metadata refresh preserves active playback position and updates the song',async()=>{
  const {engine,clock}=transport();
  try{await engine.play();clock.currentTime=.75;engine.setSong({...structuredClone(song),revision:2,title:'Renamed'});
    assert.equal(engine.state,'playing');assert.equal(engine.beat,1.5);assert.equal(engine.song.title,'Renamed');
  }finally{engine.dispose();}
});
test('finite loop terminal event is clamped to B even when a timer tick arrives late',async()=>{
  const {engine,clock}=transport();const events:{beat:number;state:string}[]=[];engine.onEvent=e=>events.push(e);
  try{await engine.configure({...defaults,loop:true,loopEnd:4,repeats:1});await engine.play();clock.currentTime=2.08;
    (engine as unknown as {tick:()=>void}).tick();
    assert.equal(engine.state,'paused');assert.equal(engine.beat,4);
    assert.equal(events.at(-1)?.beat,4);assert.equal(events.at(-1)?.state,'paused');
  }finally{engine.dispose();}
});
test('pause cancels an original audio play still waiting for the browser',async()=>{
  const {engine,media}=transport();let resolve!:()=>void;media.playPromise=new Promise<void>(r=>resolve=r);
  try{await engine.configure({...defaults,mode:'original'});const pending=engine.play();await Promise.resolve();await Promise.resolve();engine.pause();resolve();await pending;
    assert.equal(engine.state,'paused');
  }finally{engine.dispose();}
});
test('volume changes do not interrupt playback or re-strike held notes',async()=>{
  const {engine,clock}=transport();const events:string[]=[];engine.onEvent=e=>events.push(e.reason||'');
  try{await engine.play();clock.currentTime=.5;events.length=0;await engine.configure({...defaults,volume:.2});
    assert.equal(engine.state,'playing');assert.equal(engine.beat,1);assert.ok(!events.includes('pause'));
  }finally{engine.dispose();}
});
test('original audio stays at normal speed when stored piano speed is different',async()=>{
  const {engine,media}=transport();
  try{await engine.configure({...defaults,mode:'original',speed:.5});await engine.play();media.currentTime=3;
    assert.equal(media.playbackRate,1);assert.equal(engine.beat,2);
  }finally{engine.dispose();}
});
test('an original source ending at loop B enters the repeat gap instead of stopping',async()=>{
  const {engine,media}=transport();
  try{await engine.configure({...defaults,mode:'original',loop:true,loopEnd:4,gap:1});await engine.play();media.currentTime=4;media.onended?.();
    assert.equal(engine.state,'loop-gap');assert.equal(engine.beat,4);
  }finally{engine.dispose();}
});
test('starting a finished finite loop begins a fresh repeat count',async()=>{
  const {engine,clock}=transport();const tick=()=>(engine as unknown as {tick:()=>void}).tick();
  try{await engine.configure({...defaults,loop:true,loopEnd:4,gap:0,repeats:2});await engine.play();
    clock.currentTime=2;tick();tick();await new Promise(resolve=>setImmediate(resolve));
    clock.currentTime=4;tick();assert.equal(engine.state,'paused');
    await engine.play();clock.currentTime=6;tick();assert.equal(engine.state,'loop-gap');
  }finally{engine.dispose();}
});
test('playing a loop from a parked position before A starts at A',async()=>{
  const {engine}=transport();
  try{await engine.configure({...defaults,loop:true,loopStart:2,loopEnd:4});await engine.play();assert.equal(engine.beat,2);}finally{engine.dispose();}
});
test('playFromBeat supplies one beat of pre-roll and keeps playing beyond the selected phrase',async()=>{
  const {engine,clock}=transport();
  try{engine.song.score.notes[0].duration=16;await engine.playPhrase(0,4);await engine.playFromBeat(4);assert.equal(engine.beat,3);clock.currentTime=2;assert.equal(engine.beat,7);(engine as unknown as {tick:()=>void}).tick();assert.equal(engine.state,'playing');await engine.playFromBeat(.5);assert.equal(engine.beat,0);}finally{engine.dispose();}
});
test('continuous tempo accepts hundredth precision and rejects invalid rates',async()=>{
  const {engine}=transport();
  try{await engine.configure({...defaults,speed:.37});assert.equal(engine.rate,.74);await assert.rejects(()=>engine.configure({...defaults,speed:0}));await assert.rejects(()=>engine.configure({...defaults,speed:4.01}));}finally{engine.dispose();}
});
test('negative alignment starts original audio at zero and exposes the corresponding score beat',async()=>{
 const {engine,media}=transport();try{engine.song.score.notes[0].duration=32;engine.song.alignment={offset:-3,anchors:[]};await engine.configure({...defaults,mode:'original'});await engine.play();assert.equal(media.currentTime,0);assert.equal(engine.beat,6);assert.equal(engine.state,'playing');}finally{engine.dispose();}
});
