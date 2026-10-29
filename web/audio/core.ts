export type Alignment = {offset:number;anchors:{beat:number;seconds:number}[]};
function map(value:number,bpm:number,a:Alignment,inverse:boolean):number {
  if(!(bpm>0)) throw new Error('速度必须大于 0');
  const points=[...a.anchors].sort((x,y)=>x.beat-y.beat);
  for(let i=1;i<points.length;i++) if(points[i].beat<=points[i-1].beat || points[i].seconds<=points[i-1].seconds) throw new Error('对齐锚点必须按拍数和时间严格递增');
  if(!points.length) return inverse?(value-a.offset)*bpm/60:value*60/bpm+a.offset;
  if(points.length===1) return inverse?(value-points[0].seconds)*bpm/60+points[0].beat:(value-points[0].beat)*60/bpm+points[0].seconds;
  const x=(p:typeof points[number])=>inverse?p.seconds:p.beat;
  const y=(p:typeof points[number])=>inverse?p.beat:p.seconds;
  let i=points.findIndex(p=>x(p)>value)-1;
  if(i===-2)i=points.length-2;
  if(i<0)i=0;
  return y(points[i])+(value-x(points[i]))*(y(points[i+1])-y(points[i]))/(x(points[i+1])-x(points[i]));
}
export const beatToAudio=(beat:number,bpm:number,a:Alignment)=>map(beat,bpm,a,false);
export const audioToBeat=(seconds:number,bpm:number,a:Alignment)=>map(seconds,bpm,a,true);
export function loopPosition(elapsed:number,start:number,end:number,bpm:number,speed:number,gapSeconds:number) {
  if(end<=start||bpm<=0||speed<=0||gapSeconds<0)throw new Error('循环参数无效');
  const duration=(end-start)*60/bpm/speed,period=duration+gapSeconds;
  const cycle=Math.floor(Math.max(0,elapsed)/period),phase=Math.max(0,elapsed)-cycle*period;
  return {beat:phase>=duration?end:start+phase*bpm*speed/60,gap:phase>=duration,cycle};
}
export const midiFromHz=(hz:number,a4=440)=>69+12*Math.log2(hz/a4);
export const hzFromMidi=(midi:number,a4=440)=>a4*Math.pow(2,(midi-69)/12);
export function noteName(midi:number){const m=Math.round(midi);return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((m%12)+12)%12]+(Math.floor(m/12)-1);}
export type PitchOptions={minHz:number;maxHz:number;gateDb:number;confidence:number};
export function detectPitch(frame:Float32Array,sampleRate:number,options:PitchOptions={minHz:65,maxHz:1100,gateDb:-50,confidence:0.85}) {
  let energy=0,mean=0;for(const v of frame)mean+=v;mean/=frame.length;
  for(const v of frame)energy+=(v-mean)**2;
  const db=20*Math.log10(Math.max(1e-8,Math.sqrt(energy/frame.length)));
  if(db<options.gateDb)return {hz:null as number|null,confidence:0,db};
  const max=Math.min(Math.floor(sampleRate/options.minHz),Math.floor(frame.length/2)-1),min=Math.max(2,Math.floor(sampleRate/options.maxHz));
  const diff=new Float32Array(max+2);const n=frame.length-max-1;
  let sum=0;
  for(let lag=1;lag<=max+1;lag++) {let d=0;for(let i=0;i<n;i++)d+=(frame[i]-frame[i+lag])**2;sum+=d;diff[lag]=sum?d*lag/sum:1;}
  let best=-1;
  for(let lag=min;lag<=max;lag++)if(diff[lag]<1-options.confidence){while(lag<max&&diff[lag+1]<diff[lag])lag++;best=lag;break;}
  if(best<0)return {hz:null as number|null,confidence:0,db};
  const left=diff[best-1],center=diff[best],right=diff[best+1];
  const denom=2*(2*center-right-left);const refined=best+(denom?(right-left)/denom:0);
  const hz=sampleRate/refined;
  return {hz:hz>=options.minHz&&hz<=options.maxHz?hz:null,confidence:1-center,db};
}
export type TakeEvent={at:number;beat:number;state:string;rate:number;mode?:string;transpose?:number;reason?:string;audioSeconds?:number};
export function takePosition(events:TakeEvent[],seconds:number,alignment?:Alignment,bpm=120):number {
  const e=[...events].reverse().find(e=>e.at<=seconds);
  if(e?.state==='playing'&&e.mode==='original'&&e.audioSeconds!==undefined&&alignment)return audioToBeat(e.audioSeconds+seconds-e.at,bpm,alignment);
  return e?e.beat+(e.state==='playing'?(seconds-e.at)*e.rate:0):0;
}
export function takeNotes(notes:{beat:number;duration:number;midi:number|null}[],inputEvents:TakeEvent[],duration:number,alignment?:Alignment,bpm=120){
  const events:TakeEvent[]=[];
  for(const e of inputEvents){const prev=events.at(-1);if(prev&&e.state==='playing'&&prev.state==='playing'&&e.mode===prev.mode&&e.transpose===prev.transpose&&e.rate===prev.rate&&Math.abs(takePosition([prev],e.at,alignment,bpm)-e.beat)<.03)continue;events.push(e);}
  const result:{at:number;duration:number;midi:number}[]=[];
  for(let i=0;i<events.length;i++){
    const e=events[i],end=Math.min(duration,events[i+1]?.at??duration);if(e.state!=='playing'||e.rate<=0||end<=e.at)continue;
    const original=e.mode==='original'&&e.audioSeconds!==undefined&&alignment;
    const endBeat=takePosition([e],end,alignment,bpm);
    for(const n of notes){if(n.midi===null)continue;const start=Math.max(e.beat,n.beat),stop=Math.min(endBeat,n.beat+n.duration);
      if(stop>start)result.push({at:e.at+(original?beatToAudio(start,bpm,alignment!)-e.audioSeconds!:(start-e.beat)/e.rate),duration:original?beatToAudio(stop,bpm,alignment!)-beatToAudio(start,bpm,alignment!):(stop-start)/e.rate,midi:n.midi+(e.transpose??0)});
    }
  }return result;
}
export function encodeWav(channels:Float32Array[],sampleRate:number):ArrayBuffer {
  if(!channels.length||channels.some(c=>c.length!==channels[0].length))throw new Error('无效音频通道');
  const length=channels[0].length,buffer=new ArrayBuffer(44+length*channels.length*2),v=new DataView(buffer);
  const str=(at:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
  str(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels.length,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*channels.length*2,true);v.setUint16(32,channels.length*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,buffer.byteLength-44,true);
  for(let i=0;i<length;i++)for(let c=0;c<channels.length;c++){const x=Math.max(-1,Math.min(1,channels[c][i]));v.setInt16(44+(i*channels.length+c)*2,x<0?x*32768:x*32767,true);}
  return buffer;
}
