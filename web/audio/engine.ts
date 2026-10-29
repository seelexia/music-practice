import type { Song, Score } from '../types';
import {audioToBeat,beatToAudio,hzFromMidi,encodeWav,takeNotes,loopPosition,type TakeEvent} from './core';
import {loadPianoSamples,nearestSample,type PianoLibrary} from './piano';
export type Mode='piano'|'original';
export type PlaybackState='paused'|'playing'|'loop-gap';
export type PlaybackSettings={mode:Mode;speed:number;transpose:number;referenceShift:number;volume:number;loop:boolean;loopStart:number;loopEnd:number;gap:number;repeats:number;audioId:string};
export const defaults:PlaybackSettings={mode:'piano',speed:1,transpose:0,referenceShift:0,volume:0.6,loop:false,loopStart:0,loopEnd:4,gap:1,repeats:0,audioId:''};
export function pianoVoice(ctx:BaseAudioContext,destination:AudioNode,midi:number,when:number,duration:number,volume=0.35,samples=new Map<number,AudioBuffer>()):()=>void {
  if(midi<0||midi>127)throw new Error('移调后的音高超出 MIDI 0–127');
  const sample=nearestSample(samples,midi);
  if(sample){
    const source=ctx.createBufferSource(),gain=ctx.createGain(),end=when+Math.max(.03,duration);
    source.buffer=sample.buffer;source.playbackRate.value=sample.rate;
    gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(volume*1.5,when+.004);
    gain.gain.setValueAtTime(volume*1.5,end);gain.gain.exponentialRampToValueAtTime(.00001,end+.18);
    source.connect(gain);gain.connect(destination);source.start(when);source.stop(end+.2);
    source.onended=()=>{source.disconnect();gain.disconnect();};
    return ()=>{try{source.stop();}catch{/* already ended */}};
  }
  const oscillators:OscillatorNode[]=[];const root=hzFromMidi(midi);const end=when+Math.max(.03,duration);
  // Decaying, slightly inharmonic partials model struck strings. This is synthesis, not a piano recording.
  for(let h=1;h<=8;h++){
    const f=root*h*Math.sqrt(1+0.00007*h*h);if(f>ctx.sampleRate*.45)break;
    const oscillator=ctx.createOscillator(),gain=ctx.createGain();oscillator.type='sine';oscillator.frequency.value=f;
    const amplitude=volume*(h===1?.65:.42/Math.pow(h,1.65));
    gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(amplitude,when+.004);
    const sustain=amplitude*Math.exp(-Math.max(.01,duration)/(2.8/h));
    gain.gain.exponentialRampToValueAtTime(Math.max(.00002,sustain),end);gain.gain.exponentialRampToValueAtTime(.00001,end+.16);
    oscillator.connect(gain).connect(destination);oscillator.start(when);oscillator.stop(end+.18);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillators.push(oscillator);
  }
  return ()=>{for(const o of oscillators)try{o.stop();}catch{/* already ended */}};
}
export class PracticeTransport {
  context:AudioContext; state:PlaybackState='paused'; settings={...defaults}; song:Song;
  piano:PianoLibrary|null=null;pianoState:'idle'|'loading'|'sampled'|'synthesized'='idle';
  onPiano:()=>void=()=>{};private pianoLoading:Promise<PianoLibrary>|null=null;
  private originBeat=0;private originTime=0;private parkedBeat=0;private gapEnd=0;private cycle=0;
  private scheduled=new Set<string>();private voices:(()=>void)[]=[];private timer:ReturnType<typeof setInterval>;
  private media:HTMLAudioElement;private master:GainNode;private loadedUrl='';private disposed=false;private phraseEnd:number|null=null;private operation=0;
  onTick:(beat:number,state:PlaybackState)=>void=()=>{};onEvent:(event:TakeEvent)=>void=()=>{};onError:(message:string)=>void=()=>{};
  constructor(song:Song){this.song=song;this.context=new AudioContext();this.master=this.context.createGain();this.master.gain.value=defaults.volume;this.master.connect(this.context.destination);this.media=new Audio();this.media.preload='metadata';this.media.onended=()=>{if(this.state!=='playing')return;if(this.settings.loop&&this.beat>=this.settings.loopEnd-.001)this.finishAt(this.settings.loopEnd);else{this.pause();if(this.settings.loop)this.onError('原音频已结束，请将循环 B 点设在音频范围内。');}};this.media.onerror=()=>{this.pause();this.onError('原音频无法播放；请检查文件格式或重新导入。');};this.timer=setInterval(()=>this.tick(),30);}
  get beat(){if(this.state!=='playing')return this.parkedBeat;return this.settings.mode==='original'?audioToBeat(this.media.currentTime,this.song.score.bpm,this.song.alignment):this.originBeat+(this.context.currentTime-this.originTime)*this.rate;}
  get rate(){return this.settings.mode==='piano'?this.song.score.bpm*this.settings.speed/60:this.originalRate();}
  private originalRate(){const b=this.parkedBeat;return 1/(beatToAudio(b+.01,this.song.score.bpm,this.song.alignment)-beatToAudio(b,this.song.score.bpm,this.song.alignment))*.01;}
  emit(reason:string){this.onEvent({at:this.context.currentTime,beat:this.beat,state:this.state,rate:this.rate,mode:this.settings.mode,transpose:this.settings.mode==='piano'?this.settings.transpose:this.settings.referenceShift,audioSeconds:this.settings.mode==='original'?this.media.currentTime:undefined,reason});}
  private clear(){this.media.pause();for(const stop of this.voices)stop();this.voices=[];this.scheduled.clear();}
  async readyPiano(){
    if(!this.pianoLoading){this.pianoState='loading';this.onPiano();this.pianoLoading=loadPianoSamples(this.context).then(piano=>{this.piano=piano;this.pianoState=piano.state;if(!this.disposed)this.onPiano();return piano;});}
    return this.pianoLoading;
  }
  async play(){if(this.disposed||this.state==='playing')return;const operation=++this.operation;await this.context.resume();if(this.settings.mode==='piano')await this.readyPiano();if(this.disposed||operation!==this.operation)return;const end=this.settings.loop?this.settings.loopEnd:this.phraseEnd??this.endBeat;if((this.settings.loop&&this.parkedBeat<this.settings.loopStart)||this.parkedBeat>=end){this.phraseEnd=null;this.cycle=0;this.parkedBeat=this.settings.loop?this.settings.loopStart:0;}await this.start(this.parkedBeat,operation);if((this.state as PlaybackState)==='playing'&&operation===this.operation)this.emit('play');}
  get endBeat(){return Math.max(0,...this.song.score.notes.map(n=>n.beat+n.duration));}
  private async start(beat:number,operation=this.operation){this.clear();this.state='paused';this.parkedBeat=beat;this.originBeat=beat;
    if(this.settings.mode==='piano')await this.readyPiano();if(this.disposed||operation!==this.operation)return;this.originTime=this.context.currentTime;
    if(this.settings.mode==='original'){
      const asset=this.song.assets.find(a=>a.id===this.settings.audioId)||this.song.assets.find(a=>a.kind==='audio'||a.kind==='video');
      if(!asset)throw new Error('请先导入原音频');
      if(this.loadedUrl!==asset.url){this.media.src=asset.url;this.loadedUrl=asset.url;}
      const position=beatToAudio(beat,this.song.score.bpm,this.song.alignment);
      if(position<0){this.parkedBeat=audioToBeat(0,this.song.score.bpm,this.song.alignment);this.originBeat=this.parkedBeat;}
      this.media.currentTime=Math.max(0,position);this.media.playbackRate=1;this.media.volume=this.settings.volume;
      await this.media.play();if(this.disposed||operation!==this.operation)return;
    }
    this.state='playing';this.tick();
  }
  private stopAt(beat:number){this.operation++;this.parkedBeat=beat;this.state='paused';this.clear();this.emit('pause');this.onTick(this.parkedBeat,this.state);}
  pause(){this.stopAt(this.beat);}
  async seek(beat:number){const playing=this.state!=='paused';this.pause();this.phraseEnd=null;this.parkedBeat=Math.max(0,beat);this.cycle=0;if(playing)await this.start(this.parkedBeat);this.emit('seek');this.onTick(this.parkedBeat,this.state);}
  async playPhrase(start:number,end:number){this.pause();this.phraseEnd=end;this.parkedBeat=start;this.cycle=0;await this.play();this.emit('phrase');}
  async playFromBeat(beat:number,preRollBeats=1){if(!Number.isFinite(beat)||!Number.isFinite(preRollBeats))throw new Error('播放位置必须是有效拍数');this.pause();this.phraseEnd=null;this.parkedBeat=Math.max(0,beat-Math.max(0,preRollBeats));this.cycle=0;await this.play();this.emit('note');}
  async configure(settings:PlaybackSettings){
    if(!Number.isFinite(settings.speed)||settings.speed<.1||settings.speed>4)throw new Error('练习速度须在 0.10–4.00 倍之间');
    if(settings.loop&&(!Number.isFinite(settings.loopStart)||!Number.isFinite(settings.loopEnd)||settings.loopStart<0||settings.loopEnd<=settings.loopStart))throw new Error('循环结束拍必须晚于开始拍');
    const {volume:_oldVolume,referenceShift:_oldShift,...oldPlayback}=this.settings,{volume:_volume,referenceShift:_shift,...nextPlayback}=settings;
    const restart=JSON.stringify(oldPlayback)!==JSON.stringify(nextPlayback),playing=this.state!=='paused',beat=this.beat;
    if(restart)this.pause();this.settings={...settings};this.master.gain.value=settings.volume;this.media.volume=settings.volume;
    if(restart){this.parkedBeat=beat;this.cycle=0;if(playing)await this.start(settings.loop&&(beat<settings.loopStart||beat>=settings.loopEnd)?settings.loopStart:beat);}this.emit('settings');
  }
  playbackChanged(song:Song){
    const sound=(s:Song)=>JSON.stringify([s.id,s.score.bpm,s.score.notes.map(n=>[n.id,n.beat,n.duration,n.midi]),s.alignment]);
    const source=(s:Song)=>(s.assets.find(a=>a.id===this.settings.audioId)||s.assets.find(a=>a.kind==='audio'||a.kind==='video'))?.url;
    return sound(song)!==sound(this.song)||(this.settings.mode==='original'&&source(song)!==source(this.song));
  }
  setSong(song:Song){const changed=this.playbackChanged(song);if(changed)this.pause();this.song=song;if(changed){this.parkedBeat=Math.min(this.parkedBeat,this.endBeat);this.onTick(this.parkedBeat,this.state);}return changed;}
  private finishAt(end:number){
    if(this.settings.loop&&(this.settings.repeats===0||++this.cycle<this.settings.repeats)){this.parkedBeat=end;this.state='loop-gap';this.clear();this.gapEnd=this.settings.mode==='piano'?this.originTime+(end-this.originBeat)/this.rate+this.settings.gap:this.context.currentTime+this.settings.gap;this.emit('loop-gap');}
    else this.stopAt(end);
    this.onTick(this.parkedBeat,this.state);
  }
  private tick(){
    if(this.disposed)return;
    if(this.state==='loop-gap'){if(this.context.currentTime>=this.gapEnd)void this.start(this.settings.loopStart).then(()=>this.emit('loop-start')).catch(e=>{this.pause();this.onError(String(e));});this.onTick(this.parkedBeat,this.state);return;}
    if(this.state!=='playing')return;
    const beat=this.beat,end=this.settings.loop?this.settings.loopEnd:this.phraseEnd??this.endBeat;
    const phase=this.settings.mode==='piano'&&end>this.originBeat?loopPosition(this.context.currentTime-this.originTime,this.originBeat,end,this.song.score.bpm,this.settings.speed,this.settings.gap):null;
    const atEnd=phase?(phase.gap||phase.cycle>0):beat>=end;
    if(atEnd&&end>0){
      this.finishAt(end);return;
    }
    if(this.settings.mode==='piano'){
      for(const n of this.song.score.notes){if(n.midi===null||n.beat>=end||n.beat+n.duration<=this.originBeat||this.scheduled.has(n.id))continue;
        const onset=Math.max(n.beat,this.originBeat),when=this.originTime+(onset-this.originBeat)/this.rate;
        if(when>this.context.currentTime+.22)continue;
        this.scheduled.add(n.id);if(when<this.context.currentTime-.1&&n.beat+n.duration<beat)continue;
        const duration=(Math.min(n.beat+n.duration,end)-Math.max(onset,beat))/this.rate;
        if(duration>0){try{this.voices.push(pianoVoice(this.context,this.master,n.midi+this.settings.transpose,Math.max(when,this.context.currentTime),duration,.35,this.piano?.samples));}catch(e){this.pause();this.onError(String(e));return;}}
      }
    } else {
      // Snapshot the local anchor slope so take reconstruction remains correct across anchor segments.
      this.parkedBeat=beat;
    }
    this.onTick(beat,this.state);
  }
  dispose(){this.operation++;this.disposed=true;clearInterval(this.timer);this.clear();this.media.removeAttribute('src');this.media.load();void this.context.close();}
}
export async function renderPiano(score:Score,speed:number,transpose:number,samples?:Map<number,AudioBuffer>):Promise<Blob>{
  const duration=Math.max(0,...score.notes.map(n=>n.beat+n.duration))*60/score.bpm/speed+.5;
  if(duration>900)throw new Error('单次 WAV 导出限 15 分钟，请缩短谱面');
  const context=new OfflineAudioContext(2,Math.ceil(duration*44100),44100);
  for(const n of score.notes)if(n.midi!==null)pianoVoice(context,context.destination,n.midi+transpose,n.beat*60/score.bpm/speed,n.duration*60/score.bpm/speed,.28,samples);
  const buffer=await context.startRendering();return new Blob([encodeWav([buffer.getChannelData(0),buffer.getChannelData(1)],buffer.sampleRate)],{type:'audio/wav'});
}
export async function renderTake(recording:ArrayBuffer,score:Score,events:TakeEvent[],context:AudioContext,alignment?:Song['alignment'],samples?:Map<number,AudioBuffer>):Promise<Blob>{
  const voice=await context.decodeAudioData(recording);
  if(voice.duration>900)throw new Error('混合回放暂限 15 分钟；可直接播放原始录音');
  const offline=new OfflineAudioContext(2,Math.ceil((voice.duration+.3)*44100),44100),source=offline.createBufferSource();
  source.buffer=voice;source.connect(offline.destination);source.start(0);
  for(const n of takeNotes(score.notes,events,voice.duration,alignment,score.bpm))pianoVoice(offline,offline.destination,n.midi,n.at,n.duration,.17,samples);
  const rendered=await offline.startRendering();return new Blob([encodeWav([rendered.getChannelData(0),rendered.getChannelData(1)],44100)],{type:'audio/wav'});
}
