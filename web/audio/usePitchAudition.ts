import {useEffect,useRef,useState} from 'react';
import {pianoVoice} from './engine';
import {loadPianoSamples,type PianoLibrary} from './piano';
import {noteName} from './core';

/** A separate destination/context keeps audition out of take mixing and transport events. */
export function usePitchAudition(){
  const context=useRef<AudioContext|null>(null),library=useRef<PianoLibrary|null>(null),voice=useRef<(()=>void)|null>(null),generation=useRef(0),alive=useRef(true);
  const [status,setStatus]=useState('');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;voice.current?.();voice.current=null;void context.current?.close();context.current=null;};},[]);
  async function audition(midi:number){
    const operation=++generation.current;
    try{
      const ctx=context.current??new AudioContext();context.current=ctx;await ctx.resume();
      if(!alive.current||operation!==generation.current)return;
      voice.current?.();voice.current=pianoVoice(ctx,ctx.destination,midi,ctx.currentTime,.65,.22,library.current?.samples);
      setStatus(`试听 ${noteName(midi)}`);
      if(!library.current)void loadPianoSamples(ctx).then(value=>{if(alive.current&&context.current===ctx)library.current=value;});
    }catch(error){if(alive.current)setStatus(`试听失败：${error instanceof Error?error.message:String(error)}`);}
  }
  return {audition,status};
}
