export type NoiseLevel='off'|'light'|'medium'|'strong';
export function gateFromNoise(samples:number[],level:NoiseLevel):{baseline:number;gateDb:number;confidence:number}{
 const sorted=samples.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)throw Error('没有采集到环境声音，请开启麦克风后重试');
 const baseline=Math.max(-90,Math.min(-10,sorted[Math.floor(sorted.length/2)]));
 const margin={off:0,light:6,medium:12,strong:18}[level];
 return {baseline,gateDb:level==='off'?-90:Math.min(-5,baseline+margin),confidence:{off:.75,light:.8,medium:.85,strong:.92}[level]};
}
export function monitorCoordinate(point:{at:number;beat:number},live:boolean):number{return live?point.at:point.beat;}
