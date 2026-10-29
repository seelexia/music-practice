import {useRef,type RefObject,type PointerEvent} from 'react';
import {pitchCursorRatio,pitchPlotSize} from './pitch-interactions';

export type PlotSize={width:number;height:number};
type Surface=RefObject<HTMLDivElement|null>;
function release(event:PointerEvent<HTMLElement>){if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}

export function PitchSizeHandle({surface,onSize,onReset}:{surface:Surface;onSize:(size:PlotSize)=>void;onReset:()=>void}){
 const drag=useRef<{id:number;x:number;y:number;width:number;height:number}|null>(null);
 const resize=(width:number,height:number)=>{const frame=surface.current;if(frame)onSize(pitchPlotSize(width,height,frame.parentElement?.clientWidth??width,innerHeight));};
 return <button type="button" className="pitch-size-handle" aria-label="调整音高图大小" title="拖动调整音高图宽高；方向键微调，双击恢复自适应大小" onClick={e=>e.stopPropagation()} onDoubleClick={e=>{e.stopPropagation();onReset();}} onPointerDown={event=>{
  const box=surface.current?.getBoundingClientRect();if(!box)return;event.preventDefault();event.stopPropagation();drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,width:box.width,height:box.height};event.currentTarget.setPointerCapture(event.pointerId);
 }} onPointerMove={event=>{const start=drag.current;if(!start||start.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();resize(start.width+event.clientX-start.x,start.height+event.clientY-start.y);}} onPointerUp={event=>{drag.current=null;release(event);}} onPointerCancel={event=>{drag.current=null;release(event);}} onKeyDown={event=>{
  if(event.key==='Enter'){event.preventDefault();event.stopPropagation();onReset();return;}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const box=surface.current?.getBoundingClientRect();if(box)resize(box.width+(event.key==='ArrowLeft'?-16:event.key==='ArrowRight'?16:0),box.height+(event.key==='ArrowUp'?-16:event.key==='ArrowDown'?16:0));
 }}><span aria-hidden="true">↘</span></button>;
}

export function PitchNowHandle({surface,ratio,onRatio}:{surface:Surface;ratio:number;onRatio:(value:number)=>void}){
 const pointer=useRef<number|null>(null);
 return <div role="slider" aria-label="最新音位置" aria-orientation="horizontal" aria-valuemin={10} aria-valuemax={90} aria-valuenow={Math.round(ratio*100)} aria-valuetext={`最新音位于图中 ${Math.round(ratio*100)}% 处`} tabIndex={0} className="pitch-now-handle" title="左右拖动白线调整最新音的位置；双击居中" style={{left:`calc(48px + ${ratio} * (100% - 48px))`}} onClick={e=>e.stopPropagation()} onDoubleClick={e=>{e.stopPropagation();onRatio(.5);}} onPointerDown={event=>{event.preventDefault();event.stopPropagation();pointer.current=event.pointerId;event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{
  if(pointer.current!==event.pointerId)return;event.preventDefault();event.stopPropagation();const box=surface.current?.getBoundingClientRect();if(box)onRatio(pitchCursorRatio(event.clientX-box.left,box.width));
 }} onPointerUp={event=>{pointer.current=null;release(event);}} onPointerCancel={event=>{pointer.current=null;release(event);}} onKeyDown={event=>{
  const value=event.key==='ArrowLeft'?Math.max(.1,ratio-.02):event.key==='ArrowRight'?Math.min(.9,ratio+.02):event.key==='Home'?0.1:event.key==='End'?0.9:event.key==='Enter'?0.5:null;
  if(value!==null){event.preventDefault();event.stopPropagation();onRatio(value);}
 }}/>;
}
