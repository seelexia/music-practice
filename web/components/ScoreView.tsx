import {useEffect,useRef,useState,type CSSProperties,type MouseEvent} from 'react';
import {Music2,AlignLeft,Rows3,Repeat2,X} from 'lucide-react';
import type {Score,Song,Note} from '../types';
import type {OpenSheetMusicDisplay,VexFlowGraphicalNote} from 'opensheetmusicdisplay';
import {scoreNoteAtBeat,numberedNote,numberedRhythm,layoutScoreMeasures,noteLoopRange} from '../score-utils';
import {bindStaffFragments,staffPlaybackAtBeat,staffCompatibleMusicXml,type StaffBinding} from '../staff-playback';
import {lyricRowCount} from '../lyrics';
import LyricLines from './LyricLines';

export type LoopRange={start:number;end:number;enabled:boolean};
type NumberedProps={score:Score;onSeek?:(beat:number)=>void;onSelectNote?:(note:Note)=>void;beat?:number;selectedNoteId?:string|null;loopRange?:LoopRange|null;loopAnchorId?:string|null;fontSize?:number;autoScroll?:boolean};
export function NumberedScore({score,onSeek,onSelectNote,beat=-1,selectedNoteId,loopRange,loopAnchorId,fontSize=32,autoScroll=true}:NumberedProps){
  const measures=layoutScoreMeasures(score),rows=lyricRowCount(score.notes.map(note=>note.lyric));const viewport=useRef<HTMLDivElement>(null),activeId=scoreNoteAtBeat(score.notes,beat)?.id,activeSegment=activeId?`${activeId}:${measures.find(m=>beat>=m.start&&beat<m.start+m.duration)?.index}`:undefined;
  useEffect(()=>{
    if(!autoScroll||!activeId)return;
    const pane=viewport.current;if(!pane)return;
    const follow=()=>{
      const active=pane.querySelector<HTMLElement>('.score-note.active');if(!active)return;
      const outer=pane.getBoundingClientRect(),inner=active.getBoundingClientRect();
      const aboveOrBelow=inner.top<outer.top+32||inner.bottom>outer.bottom-32,leftOrRight=inner.left<outer.left+12||inner.right>outer.right-12;
      if(aboveOrBelow||leftOrRight)pane.scrollTo({top:aboveOrBelow?pane.scrollTop+inner.top-outer.top-pane.clientHeight*.35:pane.scrollTop,left:leftOrRight?pane.scrollLeft+inner.left-outer.left-12:pane.scrollLeft,behavior:'smooth'});
    };
    follow();const resize=new ResizeObserver(follow);resize.observe(pane);
    return ()=>resize.disconnect();
  },[activeSegment,autoScroll,fontSize]);
  if(!score.notes.length)return <div className="empty small"><Music2/><h3>尚无音符</h3><p>上传谱图并识别，或在音符编辑中手动录入。</p></div>;
  const notes=new Map(score.notes.map(note=>[note.id,note]));
  return <div className="notation-viewport" ref={viewport} style={{'--notation-size':`${fontSize}px`} as CSSProperties} tabIndex={0} aria-label="简谱谱面，可滚动查看"><div className="paper-numbered-score">{measures.map(measure=><div className="notation-measure" key={measure.index} aria-label={`第 ${measure.index+1} 小节`}><small className="measure-number">{measure.index+1}</small><div className="measure-notes">{measure.segments.map((segment,i)=>{
    const note=segment.noteId?notes.get(segment.noteId):undefined;
    const display=note?numberedNote(note,score.key):{number:'0',octave:0};
    const rhythm=numberedRhythm(segment.duration),inLoop=note&&loopRange?.enabled&&note.beat>=loopRange.start&&note.beat<loopRange.end;
    const content=<><span className="octave top">{!segment.continuation&&display.octave>0?'•'.repeat(Math.min(4,display.octave)):'\u00a0'}</span><b className="rhythmic-number" style={{paddingBottom:!segment.continuation?rhythm.underlines*4:0}}>{segment.continuation?'—':display.number}{!segment.continuation&&rhythm.dots>0&&<sup>{'·'.repeat(rhythm.dots)}</sup>}{!segment.continuation&&rhythm.extension&&<span className="rhythm-extension">{rhythm.extension}</span>}{!segment.continuation&&Array.from({length:rhythm.underlines},(_,line)=><i className="rhythm-underline" key={line} style={{bottom:line*4}}/>)}</b>{rhythm.fraction&&<small className="rhythm-fraction">{rhythm.fraction}</small>}<span className="octave bottom">{!segment.continuation&&display.octave<0?'•'.repeat(Math.min(4,-display.octave)):'\u00a0'}</span><span className="note-lyric"><LyricLines text={!segment.continuation?note?.lyric??'':''} rows={rows}/></span></>;
    const style={flexGrow:segment.duration,flexBasis:0} as CSSProperties;
    return note?<button type="button" key={`${note.id}-${i}`} data-note-id={note.id} aria-label={`音符 ${score.notes.indexOf(note)+1}，${display.number}，${note.duration} 拍${note.lyric?`，${note.lyric}`:''}`} aria-pressed={selectedNoteId===note.id} className={`score-note ${note.uncertain?'uncertain':''} ${activeId===note.id&&beat>=segment.beat&&beat<segment.beat+segment.duration?'active':''} ${selectedNoteId===note.id?'selected':''} ${inLoop?'in-loop':''} ${loopAnchorId===note.id?'loop-anchor':''}`} style={style} onClick={()=>onSelectNote?onSelectNote(note):onSeek?.(note.beat)} title={`第 ${note.beat+1} 拍 · 时值 ${note.duration} 拍${segment.continuation?' · 延音':''}${note.uncertain?' · 待核对':''}`}>{loopAnchorId===note.id&&<span className="loop-note-marker">A</span>}{content}</button>:<span key={`gap-${i}`} className="score-note notation-gap" title={`空拍 ${segment.duration} 拍`} style={style}>{content}</span>;
  })}</div></div>)}</div></div>;
}
function Staff({song,onSeek,beat=-1,fontSize,autoScroll}:{song:Song;onSeek:(beat:number)=>void;beat?:number;fontSize:number;autoScroll:boolean}){
  const container=useRef<HTMLDivElement>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  type Graphic={elements:(SVGElement|HTMLElement)[]};
  const bindings=useRef<StaffBinding<Graphic>[]>([]),colored=useRef<(SVGElement|HTMLElement)[]>([]),followed=useRef<Graphic|null>(null);
  const playback=useRef({notes:song.score.notes,beat,fontSize,autoScroll});playback.current={notes:song.score.notes,beat,fontSize,autoScroll};
  const renderRef=useRef<(()=>void)|null>(null);
  function highlight(){
    const current=playback.current,state=staffPlaybackAtBeat(current.notes,bindings.current,current.beat);
    const elements=[...new Set(state.active.flatMap(binding=>binding.graphic.elements))];
    if(elements.length!==colored.current.length||elements.some((element,index)=>element!==colored.current[index])){
      colored.current.forEach(element=>element.classList.remove('staff-note-active'));
      elements.forEach(element=>element.classList.add('staff-note-active'));colored.current=elements;
    }
    if(container.current)container.current.dataset.activeNoteId=state.active[0]?.noteId??'';
    const graphic=state.current?.graphic;
    if(current.autoScroll&&graphic&&graphic!==followed.current){
      const pane=container.current?.closest('.staff-viewport'),element=graphic.elements[0];
      if(pane&&element){const outer=pane.getBoundingClientRect(),inner=element.getBoundingClientRect();if(inner.top<outer.top+25||inner.bottom>outer.bottom-25)pane.scrollTo({top:pane.scrollTop+inner.top-outer.top-pane.clientHeight*.35,behavior:'smooth'});}
    }
    followed.current=current.autoScroll?(graphic??null):null;
  }
  useEffect(()=>{highlight();},[beat,autoScroll]);
  useEffect(()=>{renderRef.current?.();},[fontSize]);
  useEffect(()=>{let stopped=false;let display:OpenSheetMusicDisplay|undefined,observer:ResizeObserver|undefined,frame=0;const controller=new AbortController();setLoading(true);setError('');
    (async()=>{try{const {OpenSheetMusicDisplay}=await import('opensheetmusicdisplay');if(stopped||!container.current)return;
      const response=await fetch(`/api/songs/${song.id}/export/musicxml`,{signal:controller.signal});if(!response.ok)throw new Error('尚不能生成五线谱');const xml=await response.text();if(stopped)return;
      // Keep each full-bar rest addressable by the playback clock. OSMD's
      // automatic multirests leave collapsed MeasureList entries undefined.
      const osmd=new OpenSheetMusicDisplay(container.current,{autoResize:false,drawTitle:false,drawComposer:false,backend:'svg',autoGenerateMultipleRestMeasuresFromRestMeasures:false});display=osmd;await osmd.load(staffCompatibleMusicXml(xml));if(stopped){osmd.clear();return;}
      if(Object.values(osmd.Sheet.SheetErrors.measureErrors).some(errors=>errors.length))throw new Error('五线谱存在小节解析错误，已停用该排版以免定位错位');
      const render=()=>{if(stopped)return;try{
        osmd.Zoom=playback.current.fontSize/32;osmd.render();
        const fragments=[];
        for(const measures of osmd.GraphicSheet.MeasureList)for(const measure of measures)for(const entry of measure.staffEntries)for(const voice of entry.graphicalVoiceEntries)for(const note of voice.notes){
          const graphic=note as VexFlowGraphicalNote,elements=[graphic.getSVGGElement(),...graphic.getLyricsSVGs()].filter(element=>!!element);
          fragments.push({beat:note.sourceNote.getAbsoluteTimestamp().RealValue*4,duration:note.graphicalNoteLength.RealValue*4,graphic:{elements}});
        }
        bindings.current=bindStaffFragments(playback.current.notes,fragments);
        for(const binding of bindings.current)for(const element of binding.graphic.elements)element.dataset.staffNoteId=binding.noteId;
        colored.current=[];followed.current=null;highlight();
      }catch(e){bindings.current=[];colored.current=[];osmd.clear();setError(e instanceof Error?e.message:'五线谱排版失败');}};
      renderRef.current=render;render();let width=container.current.clientWidth;
      observer=new ResizeObserver(()=>{const next=container.current?.clientWidth??0;if(Math.abs(next-width)<1)return;width=next;cancelAnimationFrame(frame);frame=requestAnimationFrame(render);});observer.observe(container.current);
    }catch(e){if(!stopped){display?.clear();setError(e instanceof Error?e.message:'五线谱加载失败');}}finally{if(!stopped)setLoading(false);}})();
    return ()=>{stopped=true;controller.abort();observer?.disconnect();cancelAnimationFrame(frame);renderRef.current=null;bindings.current=[];colored.current=[];followed.current=null;display?.clear();};
  },[song.id,song.revision]);
  function seekNote(event:MouseEvent<HTMLDivElement>){
    const target=event.target;if(!(target instanceof Node))return;
    for(const binding of bindings.current){
      if(!binding.graphic.elements.some(element=>element.contains(target)))continue;
      const original=song.score.notes.find(note=>note.id===binding.noteId);if(original)onSeek(original.beat);return;
    }
  }
  return <><div ref={container} className="staff-score" data-zoom={fontSize/32} onClick={seekNote}/>{loading&&<p className="muted">正在排版五线谱…</p>}{error&&<><p className="notice">{error}；可继续使用简谱。</p><NumberedScore score={song.score} onSeek={onSeek} beat={beat} fontSize={fontSize} autoScroll={autoScroll}/></>}</>;
}
type Props={song:Song;onSeek:(beat:number)=>void;onPhraseSeek?:(id:string)=>void;onNoteSelect?:(id:string)=>void;selectedNoteId?:string|null;beat?:number;loopRange?:LoopRange|null;onLoopChange?:(start:number,end:number,enabled:boolean)=>void;preRoll?:number;onPreRollChange?:(value:number)=>void};
export default function ScoreView({song,onSeek,onPhraseSeek,onNoteSelect,selectedNoteId,beat,loopRange,onLoopChange,preRoll=1,onPreRollChange}:Props){
  const [view,setView]=useState<'numbered'|'staff'|'lyrics'>('numbered'),[fontSize,setFontSize]=useState(32),[autoScroll,setAutoScroll]=useState(true),[loopSelecting,setLoopSelecting]=useState(false),[loopAnchor,setLoopAnchor]=useState<string|null>(null);
  function select(note:Note){
    onNoteSelect?.(note.id);
    if(loopSelecting){
      if(!loopAnchor){setLoopAnchor(note.id);return;}
      const range=noteLoopRange(song.score.notes,loopAnchor,note.id);
      if(range)onLoopChange?.(range.start,range.end,true);
      setLoopSelecting(false);setLoopAnchor(null);return;
    }
    onSeek(note.beat);
  }
  function seek(beat:number){const note=scoreNoteAtBeat(song.score.notes,beat);if(note)select(note);}
  return <section className="card score-card notation-card"><div className="notation-toolbar"><div className="segmented">{([['numbered','简谱',Rows3],['staff','五线谱',Music2],['lyrics','歌词',AlignLeft]] as const).map(([id,label,Icon])=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}><Icon size={15}/>{label}</button>)}</div><div className="actions"><button className={loopSelecting?'primary':''} aria-pressed={loopSelecting} onClick={()=>{setLoopSelecting(!loopSelecting);setLoopAnchor(null);}}><Repeat2 size={15}/>{loopSelecting?(loopAnchor?'点选 B 终点':'点选 A 起点'):'选循环'}</button>{(loopRange?.enabled||loopAnchor)&&<button title="清除循环" onClick={()=>{onLoopChange?.(0,0,false);setLoopSelecting(false);setLoopAnchor(null);}}><X size={14}/>清除循环</button>}</div></div>
    <div className="notation-options"><span>1 = {song.score.key}　{song.score.timeSignature.join('/')}　♩ = {song.score.bpm}</span><label>字号<input aria-label="谱面字号" type="range" min="16" max="52" value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}/><span>{fontSize}</span></label><label className="check"><input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)}/>跟随播放</label>{onPreRollChange&&<label>提前<input aria-label="点击音符提前拍数" type="number" min="0" max="16" step=".5" value={preRoll} onChange={e=>onPreRollChange(Math.max(0,Math.min(16,Number(e.target.value))))}/>拍</label>}</div>
    {loopSelecting&&<p className="loop-instruction" role="status">{loopAnchor?'已选 A。再点一个音符设为 B，包含 B 音的完整时值。':'依次点击起点 A、终点 B。选择完成后按播放开始循环。'}</p>}
    {!loopSelecting&&loopRange?.enabled&&<p className="loop-instruction">循环：第 {loopRange.start+1}–{loopRange.end+1} 拍 · 按播放开始</p>}
    {view==='numbered'?<NumberedScore score={song.score} onSelectNote={select} selectedNoteId={selectedNoteId} beat={beat} fontSize={fontSize} autoScroll={autoScroll} loopRange={loopRange} loopAnchorId={loopAnchor}/>:view==='staff'?<div className="staff-viewport"><Staff song={song} onSeek={seek} beat={beat} fontSize={fontSize} autoScroll={autoScroll}/></div>:<div className="lyrics-view score-lyrics">{song.score.phrases.map(p=><div key={p.id}><small>{p.label}</small><p>{song.score.notes.filter(n=>n.phraseId===p.id).map(n=><button key={n.id} className={beat!==undefined&&beat>=n.beat&&beat<n.beat+n.duration?'active':''} onClick={()=>select(n)}><LyricLines text={n.lyric||'·'} rows={lyricRowCount(song.score.notes.filter(note=>note.phraseId===p.id).map(note=>note.lyric))}/></button>)}</p></div>)}</div>}
    <div className="notation-footer"><span>点击音符或歌词，从该音前 {preRoll} 拍播放</span>{onPhraseSeek&&<details><summary>从乐句开头播放</summary><div className="phrase-play-actions">{song.score.phrases.map(p=><button key={p.id} onClick={()=>onPhraseSeek(p.id)}>{p.label}</button>)}</div></details>}</div>
  </section>;
}




