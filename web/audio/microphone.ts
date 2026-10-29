import {detectPitch,type PitchOptions} from './core';
export type PitchFrame={hz:number|null;rawHz:number|null;db:number;confidence:number;time:number};
export type MicOptions=PitchOptions&{smoothing:number;inputGain:number;noiseSuppression:boolean;echoCancellation:boolean};
export const micDefaults:MicOptions={minHz:70,maxHz:1100,gateDb:-48,confidence:.85,smoothing:.35,inputGain:1,noiseSuppression:false,echoCancellation:false};
const processor=`class PitchCapture extends AudioWorkletProcessor {
 constructor(){super();this.ring=new Float32Array(4096);this.index=0;this.count=0;}
 process(inputs){const channel=inputs[0]?.[0];if(channel){for(let i=0;i<channel.length;i++){this.ring[this.index]=channel[i];this.index=(this.index+1)%4096;this.count++;}
 if(this.count>=2048){this.count=0;const frame=new Float32Array(4096);for(let i=0;i<4096;i++)frame[i]=this.ring[(this.index+i)%4096];this.port.postMessage({frame,time:currentTime},[frame.buffer]);}}
 return true;}}
registerProcessor('music-pitch-capture',PitchCapture);`;
const loadedContexts=new WeakSet<AudioContext>();
export class Microphone {
  stream:MediaStream|null=null;options:MicOptions={...micDefaults};settings:MediaTrackSettings={};
  private source:MediaStreamAudioSourceNode|null=null;private node:AudioWorkletNode|null=null;private silent:GainNode|null=null;private smoothed:number|null=null;
  private operation=0;
  onFrame:(frame:PitchFrame)=>void=()=>{};onEnded:()=>void=()=>{};
  constructor(private context:AudioContext){}
  async start(options:MicOptions,deviceId=''){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('此浏览器或网址无法访问麦克风，请使用 localhost 的现代浏览器');
    this.stop();this.options={...options};const operation=++this.operation;
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,noiseSuppression:options.noiseSuppression,echoCancellation:options.echoCancellation,autoGainControl:false,...(deviceId?{deviceId:{exact:deviceId}}:{})}});
    if(operation!==this.operation){stream.getTracks().forEach(track=>track.stop());return;}
    this.stream=stream;this.settings=stream.getAudioTracks()[0].getSettings();
    try{
      await this.context.resume();
      if(operation!==this.operation)return;
      if(!loadedContexts.has(this.context)){const url=URL.createObjectURL(new Blob([processor],{type:'text/javascript'}));
      try{await this.context.audioWorklet.addModule(url);loadedContexts.add(this.context);}finally{URL.revokeObjectURL(url);}}
      if(operation!==this.operation)return;
      this.source=this.context.createMediaStreamSource(stream);this.node=new AudioWorkletNode(this.context,'music-pitch-capture');this.silent=this.context.createGain();this.silent.gain.value=0;
      this.source.connect(this.node).connect(this.silent).connect(this.context.destination);
      this.node.port.onmessage=({data}:{data:{frame:Float32Array;time:number}})=>{
        const frame=data.frame;if(this.options.inputGain!==1)for(let i=0;i<frame.length;i++)frame[i]*=this.options.inputGain;
        const result=detectPitch(frame,this.context.sampleRate,this.options);
        if(result.hz===null)this.smoothed=null;
        else this.smoothed=this.smoothed===null?result.hz:Math.pow(2,(1-this.options.smoothing)*Math.log2(result.hz)+this.options.smoothing*Math.log2(this.smoothed));
        this.onFrame({hz:this.smoothed,rawHz:result.hz,db:result.db,confidence:result.confidence,time:data.time});
      };
      stream.getAudioTracks()[0].onended=()=>{this.stop();this.onEnded();};
    }catch(error){if(operation===this.operation)this.stop();throw error;}
  }
  stop(){this.operation++;if(this.node){this.node.port.onmessage=null;this.node.disconnect();}this.source?.disconnect();this.silent?.disconnect();this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=null;this.source=null;this.node=null;this.silent=null;this.smoothed=null;}
}
