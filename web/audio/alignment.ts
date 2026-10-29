import {beatToAudio,type Alignment} from './core';
function check(beat:number,seconds:number,bpm:number){if(!Number.isFinite(beat)||beat<0||!Number.isFinite(seconds)||seconds<0||!Number.isFinite(bpm)||bpm<=0)throw new Error('对齐位置须为有效的非负拍数和音频秒数');}
export function alignmentAtAudio(beat:number,seconds:number,bpm:number):Alignment{check(beat,seconds,bpm);return {offset:seconds-beat*60/bpm,anchors:[]};}
export function addAlignmentAnchor(alignment:Alignment,beat:number,seconds:number,bpm:number):Alignment{
 check(beat,seconds,bpm);const next={...alignment,anchors:[...alignment.anchors.filter(a=>a.beat!==beat),{beat,seconds}].sort((a,b)=>a.beat-b.beat)};beatToAudio(beat,bpm,next);return next;
}
export function estimateAlignmentTempo(anchors:Alignment['anchors'],scoreBpm:number):{bpm:number;speed:number}{
 if(anchors.length<2)throw new Error('至少需要两个对齐锚点才能估算练习速度');
 const sorted=[...anchors].sort((a,b)=>a.beat-b.beat);for(const anchor of sorted)check(anchor.beat,anchor.seconds,scoreBpm);
 for(let i=1;i<sorted.length;i++)if(sorted[i].beat<=sorted[i-1].beat||sorted[i].seconds<=sorted[i-1].seconds)throw new Error('估算速度需要拍数和秒数均严格递增的锚点');
 const first=sorted[0],last=sorted[sorted.length-1],bpm=60*(last.beat-first.beat)/(last.seconds-first.seconds);return {bpm,speed:bpm/scoreBpm};
}
