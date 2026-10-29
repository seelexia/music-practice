export type PianoLibrary={state:'sampled'|'synthesized';name:string;license:string;attribution:string;samples:Map<number,AudioBuffer>};
const libraries=new WeakMap<BaseAudioContext,Promise<PianoLibrary>>();
export function loadPianoSamples(context:BaseAudioContext,request:typeof fetch=fetch):Promise<PianoLibrary>{
  const cached=libraries.get(context);if(cached)return cached;
  const promise=(async():Promise<PianoLibrary>=>{
    try{
      const signal=AbortSignal.timeout(12000),response=await request('/piano/manifest.json',{signal});
      if(!response.ok)throw new Error('Missing piano manifest');
      const manifest=await response.json() as {name?:unknown;license?:unknown;attribution?:unknown;samples?:Record<string,unknown>};
      const entries=Object.entries(manifest.samples||{});
      if(!entries.length||entries.length>128)throw new Error('Invalid piano manifest');
      const samples=await Promise.all(entries.map(async([key,path]):Promise<[number,AudioBuffer]>=>{
        const root=Number(key);
        if(!Number.isInteger(root)||root<0||root>127||typeof path!=='string'||!/^\/piano\/[A-Za-z0-9_-]+\.(mp3|wav|ogg)$/.test(path))throw new Error('Invalid local piano sample');
        const sample=await request(path,{signal});if(!sample.ok)throw new Error('Missing piano sample');
        return [root,await context.decodeAudioData(await sample.arrayBuffer())];
      }));
      return {state:'sampled',name:typeof manifest.name==='string'?manifest.name:'采样钢琴',license:typeof manifest.license==='string'?manifest.license:'',attribution:typeof manifest.attribution==='string'?manifest.attribution:'',samples:new Map(samples)};
    }catch{
      return {state:'synthesized',name:'击弦泛音合成',license:'',attribution:'',samples:new Map()};
    }
  })();
  libraries.set(context,promise);return promise;
}
export function nearestSample(samples:Map<number,AudioBuffer>,midi:number):{root:number;buffer:AudioBuffer;rate:number}|null{
  let root:number|undefined;
  for(const key of samples.keys())if(root===undefined||Math.abs(key-midi)<Math.abs(root-midi)||(Math.abs(key-midi)===Math.abs(root-midi)&&key<root))root=key;
  return root===undefined?null:{root,buffer:samples.get(root)!,rate:Math.pow(2,(midi-root)/12)};
}
