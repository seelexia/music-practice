import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import {Plus,Save,Trash2,Undo2,History,Maximize,Minimize} from 'lucide-react';
import type {Note,Score,ScoreHistory,Song} from '../types';
import {api,patchSong,downloadText} from '../api';
import {parseScoreDraft,updateScoreNote,scoreSource,transposeScoreKey,numberedNote,parseHumanPitch,insertScoreNote,deleteScoreNote,withoutScoreMeasures} from '../score-utils';
import {NumberedScore} from './ScoreView';
import NoteInspector from './NoteInspector';

export default function ScoreEditor({song,onSongChange,onError,onDirtyChange}:{song:Song;onSongChange:(s:Song)=>void;onError:(s:string)=>void;onDirtyChange:(dirty:boolean)=>void}){
  const [draft,setDraft]=useState<Score>(()=>structuredClone(song.score)),[baseline,setBaseline]=useState(()=>JSON.stringify(song.score)),[base,setBase]=useState(song.revision),[undo,setUndo]=useState<Score[]>([]),[history,setHistory]=useState<ScoreHistory[]>([]),[busy,setBusy]=useState(false),[page,setPage]=useState(''),[selected,setSelected]=useState<string|null>(song.score.notes[0]?.id??null),[fontSize,setFontSize]=useState(32),[showSource,setShowSource]=useState(false),[fullscreen,setFullscreen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const dirty=JSON.stringify(draft)!==baseline,images=[...song.assets,...(song.archivedAssets||[])].filter(a=>a.kind==='score'),index=draft.notes.findIndex(n=>n.id===selected),note=draft.notes[index];
  useEffect(()=>{onDirtyChange(dirty);return ()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  useEffect(()=>{if(!dirty){setDraft(structuredClone(song.score));setBaseline(JSON.stringify(song.score));setBase(song.revision);}},[song.revision]);
  useEffect(()=>{api<ScoreHistory[]>(`/songs/${song.id}/history`).then(setHistory).catch(e=>onError(e.message));},[song.revision]);
  useEffect(()=>{const change=()=>setFullscreen(document.fullscreenElement===root.current);document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change);},[]);
  function edit(next:Score,timingChanged=false){setUndo(old=>[...old.slice(-49),structuredClone(draft)]);setDraft({...(timingChanged?withoutScoreMeasures(next):next),status:'corrected'});}
  async function save(){setBusy(true);try{const result=await patchSong({...song,revision:base},{score:draft});onSongChange(result);setBase(result.revision);setBaseline(JSON.stringify(result.score));setDraft(result.score);setUndo([]);}catch(e){onError((e as Error).message);}finally{setBusy(false);}}
  function updateNote(change:Partial<Note>){try{edit({...draft,notes:updateScoreNote(draft.notes,index,change)},change.duration!==undefined&&change.duration!==draft.notes[index]?.duration);}catch(e){onError((e as Error).message);}}
  function chooseNote(next:Note){setSelected(next.id);const source=scoreSource(next.sourcePage,images);if(source.assetId)setPage(source.assetId);}
  function move(direction:number){const next=draft.notes[index+direction];if(next){chooseNote(next);requestAnimationFrame(()=>{const active=root.current?.querySelector<HTMLElement>(`[data-note-id="${next.id}"]`);active?.focus({preventScroll:true});active?.scrollIntoView({block:'nearest',inline:'nearest'});});}}
  function add(after:boolean,append=false){
    const phrase=note?draft.phrases.find(p=>p.id===note.phraseId):draft.phrases[0]??{id:crypto.randomUUID(),label:'第 1 句'};
    const added:Note={id:crypto.randomUUID(),beat:0,duration:note?.duration??1,midi:note?note.midi:parseHumanPitch('1',draft.key).midi,lyric:'',phraseId:phrase!.id,uncertain:false};
    const at=append?draft.notes.length:index<0?draft.notes.length:index+(after?1:0);
    edit({...draft,phrases:draft.phrases.some(p=>p.id===phrase!.id)?draft.phrases:[...draft.phrases,phrase!],notes:insertScoreNote(draft.notes,at,added)},true);setSelected(added.id);
  }
  function remove(){edit({...draft,notes:deleteScoreNote(draft.notes,index)},true);setSelected(draft.notes[index+1]?.id??draft.notes[index-1]?.id??null);}
  function keyboard(event:KeyboardEvent<HTMLDivElement>){
    if(event.altKey||event.ctrlKey||event.metaKey||event.nativeEvent.isComposing)return;
    const target=event.target as HTMLElement;if(['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable)return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}
    else if(note&&/^[0-7]$/.test(event.key)){event.preventDefault();try{const d=numberedNote(note,draft.key);updateNote(parseHumanPitch(event.key,draft.key,d.octave,0));}catch(e){onError((e as Error).message);}}
    else if(note&&event.key==='Delete'){event.preventDefault();remove();}
  }
  const image=images.find(a=>a.id===(page||images[0]?.id))??images[0];
  return <div ref={root} className={`notation-editor ${fullscreen?'is-fullscreen':''}`} onKeyDown={keyboard}><section className="card editor-main"><div className="section-header"><h2>音符编辑 {dirty&&<span className="badge warning">未保存</span>}</h2><div className="actions"><button disabled={!undo.length} onClick={()=>{const previous=undo[undo.length-1];setDraft(previous);if(!previous.notes.some(n=>n.id===selected))setSelected(previous.notes[0]?.id??null);setUndo(undo.slice(0,-1));}}><Undo2 size={15}/>撤销</button><button className="primary" disabled={busy||!dirty} onClick={save}><Save size={15}/>{busy?'保存中…':'保存谱面'}</button><button title={fullscreen?'退出编辑全屏':'编辑全屏'} onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void root.current?.requestFullscreen();}}>{fullscreen?<Minimize size={15}/>:<Maximize size={15}/>}</button></div></div>
  {song.revision!==base&&dirty&&<div className="notice warning">歌曲版本已变化，本地修改仍保留。请先导出当前草稿，再刷新对照合并。<button onClick={()=>downloadText(`${song.title}-纠错草稿.json`,JSON.stringify(draft,null,2),'application/json')}>导出草稿</button></div>}
  <div className="editor-score-settings"><label>速度<input aria-label="编辑谱面速度" type="number" min="20" max="300" value={draft.bpm} onChange={e=>edit({...draft,bpm:Number(e.target.value)})}/></label><label>1 =<select aria-label="编辑谱面调号" value={draft.key} onChange={e=>{try{edit(transposeScoreKey(draft,e.target.value));}catch(error){onError((error as Error).message);}}}>{['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'].map(k=><option key={k}>{k}</option>)}</select></label><label>拍号<input aria-label="每小节拍数" type="number" min="1" max="32" value={draft.timeSignature[0]} onChange={e=>edit({...draft,timeSignature:[Number(e.target.value),draft.timeSignature[1]]},true)}/><span>/</span><select aria-label="拍号分母" value={draft.timeSignature[1]} onChange={e=>edit({...draft,timeSignature:[draft.timeSignature[0],Number(e.target.value)]},true)}>{[1,2,4,8,16].map(v=><option key={v}>{v}</option>)}</select></label><label>字号<input aria-label="编辑谱面字号" type="range" min="16" max="48" value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}/></label><button onClick={()=>setShowSource(!showSource)} aria-pressed={showSource}>{showSource?'收起原图':'对照原图'}</button><button onClick={()=>add(true,true)}><Plus size={14}/>末尾加音</button></div>
  <p className="editor-keyboard-hint">点击谱面选音，右侧修改后按 Enter 应用。谱面聚焦时：1–7 / 0 改音，← → 选音，Delete 删除。</p>
  <div className={`note-edit-workspace ${showSource&&image?'with-source':''}`}>
    {showSource&&image&&<aside className="editor-source"><select aria-label="选择谱图" value={image.id} onChange={e=>setPage(e.target.value)}>{images.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select><div className="editor-source-scroll"><a href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt="原始谱图，点击查看大图"/></a></div></aside>}
    <div className="editor-sheet"><NumberedScore score={draft} onSelectNote={chooseNote} selectedNoteId={selected} fontSize={fontSize} autoScroll={false}/>{!note&&<button className="add-wide" onClick={()=>add(true)}><Plus size={16}/>添加音符</button>}</div>
    {note&&<NoteInspector key={`${note.id}-${JSON.stringify(note)}-${draft.key}`} note={note} index={index} count={draft.notes.length} scoreKey={draft.key} phrases={draft.phrases} onApply={updateNote} onMove={move} onInsert={add} onDelete={remove} onError={onError}/>}
  </div>
  <div className="editor-advanced"><details className="phrase-editor"><summary>管理乐句 · {draft.phrases.length} 句</summary><div className="phrase-management">{draft.phrases.map(p=><div className="inline" key={p.id}><input aria-label="乐句名称" value={p.label} onChange={e=>edit({...draft,phrases:draft.phrases.map(x=>x.id===p.id?{...x,label:e.target.value}:x)})}/><button title="删除空乐句" disabled={draft.notes.some(n=>n.phraseId===p.id)} onClick={()=>edit({...draft,phrases:draft.phrases.filter(x=>x.id!==p.id)})}><Trash2 size={15}/></button></div>)}</div><button onClick={()=>edit({...draft,phrases:[...draft.phrases,{id:crypto.randomUUID(),label:`第 ${draft.phrases.length+1} 句`}]})}><Plus size={15}/>添加乐句</button></details>
  <details className="phrase-editor"><summary>导入 / 导出谱面草稿</summary><p className="hint">导入只进入本地草稿；保存后才生成新版本。所有已有时间点会保留。</p><input aria-label="导入谱面 JSON" type="file" accept="application/json,.json" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>10*1024*1024)throw new Error('谱面 JSON 不能超过 10 MB');const parsed=parseScoreDraft(await file.text());edit(parsed);setSelected(parsed.notes[0]?.id??null);}catch(error){onError((error as Error).message);}finally{e.target.value='';}}}/><button onClick={()=>downloadText(`${song.title}-纠错草稿.json`,JSON.stringify(draft,null,2),'application/json')}>导出当前草稿</button></details>
  <details className="version-history"><summary><History size={16}/>历史版本 · {history.length}</summary><p className="hint">载入历史仅进入本地草稿，保存后生成新版本。</p>{history.map(h=><div className="history-row" key={h.revision}><span>版本 {h.revision} · {new Date(h.at).toLocaleString()} · {h.score.notes.length} 音符</span><button onClick={()=>{edit(structuredClone(h.score));setSelected(h.score.notes[0]?.id??null);}}>载入此谱面</button></div>)}</details></div></section></div>;
}





