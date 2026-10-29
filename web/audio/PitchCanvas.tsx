import {useEffect,useRef,useState} from 'react';
import type {Score} from '../types';
import {noteName} from './core';
import {monitorCoordinate} from './monitor';
import {activeReferenceMidi,approximatePitchNotes,pitchAxisNotes,pitchGridNotes,pitchSolfege,pitchTimeline,pointerPitch,zoomPitchRange} from './pitch-interactions';
import {usePitchAudition} from './usePitchAudition';
import {PitchNowHandle,PitchSizeHandle,type PlotSize} from './PitchPlotHandles';
import './pitch-reference.css';
export type Point={beat:number;midi:number|null;raw:number|null;at:number;continuityId?:number};
export function PitchCanvas({score,beat,points,shift,range,onRangeChange,raw,onSeek,liveTime,showReference=true,referenceActive=true,secondsSpan=12,speed=1}:{score:Score;beat:number;points:Point[];shift:number;range:[number,number];onRangeChange:(range:[number,number])=>void;raw:boolean;onSeek:(beat:number)=>void;liveTime?:number;showReference?:boolean;referenceActive?:boolean;secondsSpan?:number;speed?:number}){
  const ref=useRef<HTMLCanvasElement>(null),surface=useRef<HTMLDivElement>(null),interaction=useRef({range,onRangeChange,top:32});
  const [showNotes,setShowNotes]=useState(true),[showSolfege,setShowSolfege]=useState(false),[includeSemitones,setIncludeSemitones]=useState(true),[height,setHeight]=useState(300);const {audition,status}=usePitchAudition();
  const [size,setSize]=useState<PlotSize|null>(null),[liveAnchor,setLiveAnchor]=useState(.5);
  const live=liveTime!==undefined,cursor=live?liveTime:beat,span=live?secondsSpan:secondsSpan*score.bpm*speed/60;
  const {start,end,cursorRatio}=pitchTimeline(cursor,span,live,liveAnchor),topPadding=showNotes||showSolfege?32:16;
  interaction.current={range,onRangeChange,top:topPadding};
  const boxes=showNotes?approximatePitchNotes(points,live):[];
  const labelStep=(height-topPadding-16)/(range[1]-range[0])>=15?1:(height-topPadding-16)/(range[1]-range[0])>=8?2:6;
  const activeMidi=activeReferenceMidi(score.notes,beat,shift,{showReference,referenceActive,live});
  const gridNotes=pitchGridNotes(range,includeSemitones),axisNotes=pitchAxisNotes(range,includeSemitones,labelStep,activeMidi);
  const referenceNotes=showReference&&!live?score.notes.filter(note=>note.midi!==null&&note.midi+shift>=range[0]&&note.midi+shift<=range[1]&&note.beat+note.duration>start&&note.beat<start+span):[];
  const humanHeight=Math.max(12,Math.min(25,(height-topPadding-16)/(range[1]-range[0])*.84));
  const labels=[
    ...(showSolfege?referenceNotes.map(note=>({id:`reference-${note.id}`,kind:'reference',midi:note.midi!+shift,start:note.beat,end:note.beat+note.duration,boxHeight:6,text:pitchSolfege(note.midi!+shift,score.key,shift,note.degree)})):[]),
    ...boxes.filter(box=>box.end>start&&box.start<start+span&&box.midi>=range[0]&&box.midi<=range[1]).map((box,index)=>({id:`human-${index}`,kind:'human',midi:box.midi,start:box.start,end:box.end,boxHeight:humanHeight,text:showSolfege?pitchSolfege(box.midi,live?'C':score.key,live?0:shift):noteName(box.midi)}))
  ];
  useEffect(()=>{const canvas=ref.current,frame=canvas?.parentElement;if(!canvas||!frame)return;const wheel=(event:WheelEvent)=>{if(!event.deltaY)return;event.preventDefault();const rect=canvas.getBoundingClientRect(),current=interaction.current;current.onRangeChange(zoomPitchRange(current.range,event.clientY-rect.top,rect.height,event.deltaY,current.top,16));};frame.addEventListener('wheel',wheel,{passive:false});return()=>frame.removeEventListener('wheel',wheel);},[]);
  useEffect(()=>{const canvas=ref.current;if(!canvas)return;const draw=()=>{
    const width=canvas.clientWidth,height=canvas.clientHeight,dpr=window.devicePixelRatio||1;setHeight(previous=>previous===height?previous:height);canvas.width=width*dpr;canvas.height=height*dpr;
    const c=canvas.getContext('2d');if(!c)return;c.scale(dpr,dpr);c.fillStyle='#101e29';c.fillRect(0,0,width,height);
    const left=48,w=width-left;const x=(b:number)=>left+(b-start)/span*w,y=(m:number)=>height-16-(m-range[0])/(range[1]-range[0])*(height-topPadding-16);
    c.font='10px system-ui';
    for(const m of gridNotes){const yy=y(m);c.strokeStyle=m%12===0?'#3b515f':'#253643';c.lineWidth=m%12===0?1.1:.6;c.beginPath();c.moveTo(left,yy);c.lineTo(width,yy);c.stroke();}
    for(let b=Math.max(0,Math.ceil(start));b<start+span;b++){c.strokeStyle=b%4===0?'#3b515f':'#233340';c.beginPath();c.moveTo(x(b),0);c.lineTo(x(b),height);c.stroke();if(b%4===0){c.fillStyle='#6d8596';c.fillText(live?`${b}s`:`${b+1}`,x(b)+4,height-3);}}
    c.save();c.beginPath();c.rect(left,0,w,height);c.clip();
    for(const n of referenceNotes){c.fillStyle=n.uncertain?'#ba8b5860':'#d5a45b80';const yy=y(n.midi!+shift);c.fillRect(x(n.beat),yy-3,Math.max(2,n.duration/span*w-1),6);}
    for(const box of boxes){
      if(box.end<start||box.start>start+span||box.midi<range[0]||box.midi>range[1])continue;
      const xx=x(Math.max(start,box.start)),right=x(Math.min(start+span,box.end)),hh=Math.max(12,Math.min(25,(height-topPadding-16)/(range[1]-range[0])*.84)),yy=y(box.midi)-hh/2,ww=Math.max(3,right-xx);
      c.fillStyle='#57d8b329';c.strokeStyle='#72e4c0';c.lineWidth=1;c.fillRect(xx,yy,ww,hh);c.strokeRect(xx,yy,ww,hh);
    }
    const trace=(key:'midi'|'raw',color:string,lineWidth:number)=>{c.strokeStyle=color;c.lineWidth=lineWidth;c.beginPath();let prev:Point|null=null;for(const p of points){const value=p[key],position=monitorCoordinate(p,live);if(value===null||position<start||position>start+span){prev=null;continue;}if(prev&&prev.continuityId===p.continuityId&&prev[key]!==null&&position>=monitorCoordinate(prev,live)&&position-monitorCoordinate(prev,live)<1&&p.at-prev.at<.25)c.lineTo(x(position),y(value));else c.moveTo(x(position),y(value));prev=p;}c.stroke();};
    if(raw)trace('raw','#6e9faf88',1);trace('midi','#5ee2bc',2.1);
    c.strokeStyle='#eef7fa';c.lineWidth=1;c.beginPath();c.moveTo(x(cursor),0);c.lineTo(x(cursor),height);c.stroke();c.restore();
  };draw();const observer=new ResizeObserver(draw);observer.observe(canvas);return()=>observer.disconnect();},[score,beat,points,shift,range,raw,start,span,live,cursor,showReference,showNotes,showSolfege,includeSemitones,topPadding]);
  return <>
    <div ref={surface} className={`pitch-canvas-shell ${size?'is-user-sized':''}`} data-user-sized={!!size} style={size?{width:`min(100%, ${size.width}px)`,height:size.height}:undefined} onClick={event=>{
      const rect=ref.current?.getBoundingClientRect();if(!rect)return;
      if(event.clientX-rect.left<48){void audition(Math.round(pointerPitch(range,event.clientY-rect.top,rect.height,topPadding,16)));return;}
      if(!live)onSeek(Math.max(0,start+(event.clientX-rect.left-48)/(rect.width-48)*span));
    }}>
      <canvas ref={ref} className="pitch-canvas" data-grid-notes={gridNotes.join(',')} data-note-box-count={boxes.length} data-range-low={range[0]} data-range-high={range[1]} data-plot-top={topPadding} data-time-start={start} data-time-end={end} aria-label={live?'实时监听音高网格，横轴为秒':'歌曲音高网格，横轴为拍，可点击定位'}/>
      <div className="pitch-block-labels">{labels.map(label=>{
        const description=`${label.kind==='reference'?'参考音':'近似人声音符'} ${noteName(label.midi)}${showSolfege?` · 唱名 ${label.text}`:''}`;
        return <span key={label.id} role="img" tabIndex={showSolfege?0:undefined} className={`pitch-block-label pitch-block-label-${label.kind}`} data-pitch-label-kind={label.kind} data-midi={label.midi} data-solfege={showSolfege?label.text:undefined} title={description} aria-label={description} style={{left:`${(Math.max(start,label.start)-start)/span*100}%`,width:`max(${label.kind==='reference'?2:3}px, calc(${(Math.min(start+span,label.end)-Math.max(start,label.start))/span*100}% - ${label.kind==='reference'?1:0}px))`,top:`calc(100% - 16px - ${(label.midi-range[0])/(range[1]-range[0])} * (100% - ${topPadding+16}px) - ${label.boxHeight/2+3}px)`,height:14}}>{label.text}</span>;
      })}</div>
      <div className="pitch-axis-notes">{axisNotes.map(midi=><button type="button" key={midi} aria-current={midi===activeMidi?'true':undefined} aria-label={`试听 ${noteName(midi)}`} title={`点击试听 ${noteName(midi)}${midi===activeMidi?' · 当前参考音':''}`} style={{top:`calc(100% - 16px - ${(midi-range[0])/(range[1]-range[0])} * (100% - ${topPadding+16}px))`}} onClick={event=>{event.stopPropagation();void audition(midi);}}>{noteName(midi)}</button>)}</div>
      {live&&<PitchNowHandle surface={surface} ratio={cursorRatio} onRatio={setLiveAnchor}/>}
      <PitchSizeHandle surface={surface} onSize={setSize} onReset={()=>setSize(null)}/>
    </div>
    <div className="pitch-interaction-tools">
      <label><input type="checkbox" checked={includeSemitones} onChange={event=>setIncludeSemitones(event.target.checked)}/>显示半音</label>
      <label><input type="checkbox" checked={showNotes} onChange={event=>setShowNotes(event.target.checked)}/>近似音符框</label>
      <label><input type="checkbox" checked={showSolfege} onChange={event=>setShowSolfege(event.target.checked)}/>显示唱名</label>
      <span>滚轮上放大、下缩小 · 左侧音名可试听 · 右下角拖动大小{live?' · 拖白线移动最新音，双击居中':''}</span><span role="status" className="pitch-audition-status">{status}</span>
    </div>
  </>;
}

