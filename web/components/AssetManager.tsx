import {useState} from 'react';
import {ArrowUp,ArrowDown,Archive,RotateCcw} from 'lucide-react';
import type {Song,Asset} from '../types';
import {api} from '../api';
export default function AssetManager({song,onSongChange,onError}:{song:Song;onSongChange:(s:Song)=>void;onError:(s:string)=>void}){
 const [busy,setBusy]=useState(false);const archived=(song as Song&{archivedAssets?:Asset[]}).archivedAssets||[];const scores=song.assets.filter(a=>a.kind==='score');
 async function change(id:string,patch:Record<string,unknown>){setBusy(true);try{onSongChange(await api<Song>(`/songs/${song.id}/assets/${id}/manage`,{method:'POST',body:JSON.stringify({revision:song.revision,...patch})}));}catch(e){onError((e as Error).message);}finally{setBusy(false);}}
 return <section className="card"><details><summary>素材顺序与归档 · {song.assets.length} 个使用中，{archived.length} 个已归档</summary><p className="hint">谱图按下方顺序识别。归档的素材不参与新识谱或播放，原文件仍保留，可随时恢复；已有谱面不会随素材归档而删除。</p>{song.assets.map(a=><div className="history-row" key={a.id}><span>{a.name}</span><div className="actions">{a.kind==='score'&&<><button disabled={busy||scores[0]?.id===a.id} aria-label={`上移谱图 ${a.name}`} onClick={()=>void change(a.id,{move:'up'})}><ArrowUp size={14}/></button><button disabled={busy||scores.at(-1)?.id===a.id} aria-label={`下移谱图 ${a.name}`} onClick={()=>void change(a.id,{move:'down'})}><ArrowDown size={14}/></button></>}<button disabled={busy} onClick={()=>void change(a.id,{archived:true})}><Archive size={14}/>归档素材</button></div></div>)}{archived.map(a=><div className="history-row" key={a.id}><span className="muted">{a.name} · 已归档</span><button disabled={busy} onClick={()=>void change(a.id,{archived:false})}><RotateCcw size={14}/>恢复素材</button></div>)}</details></section>;
}
