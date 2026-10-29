import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureVideoFrame} from './components/AssetsPanel.tsx';

test('video frame captures preserve the selected score or cover destination',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  const png=new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(tag:string)=>{
    assert.equal(tag,'canvas');
    return {width:0,height:0,getContext:()=>({drawImage:()=>{}}),toBlob:(done:(value:Blob)=>void)=>done(png)};
  }}});
  try{
    const video={videoWidth:1920,videoHeight:1080,currentTime:12.25} as HTMLVideoElement;
    const saved:{file:File;kind:string}[]=[];
    for(const kind of ['score','cover'] as const){
      await captureVideoFrame(video,'source.webm',kind,async(file,destination)=>{saved.push({file,kind:destination});});
    }
    assert.deepEqual(saved.map(item=>item.kind),['score','cover']);
    assert.equal(saved[0].file.name,'source.webm-12.3s.png');
    assert.equal(saved[0].file.type,'image/png');
    assert.deepEqual(new Uint8Array(await saved[0].file.arrayBuffer()),new Uint8Array([137,80,78,71]));
  }finally{
    if(original)Object.defineProperty(globalThis,'document',original);
    else Reflect.deleteProperty(globalThis,'document');
  }
});
