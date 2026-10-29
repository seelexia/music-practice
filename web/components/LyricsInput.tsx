import {useEffect,useState} from 'react';
import {AlignLeft,Save,ScanLine,RotateCcw} from 'lucide-react';
import type {Job,Song} from '../types';
import {api,patchSong} from '../api';

export default function LyricsInput({song,disabled,onSongChange,onJob,onError,onDraftChange,onBusyChange}:{song:Song;disabled:boolean;onSongChange:(song:Song)=>void;onJob:(job:Job)=>void;onError:(message:string)=>void;onDraftChange?:(text:string)=>void;onBusyChange?:(busy:boolean)=>void}){
 const key=`music-lyrics-draft:${song.id}`;
 const [baseline,setBaseline]=useState(song.lyricsText||'');
 const [text,setText]=useState(()=>{try{return typeof localStorage!=='undefined'?localStorage.getItem(key)??song.lyricsText??'':song.lyricsText||'';}catch{return song.lyricsText||'';}});
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
 useEffect(()=>{setText(old=>old===baseline?song.lyricsText||'':old);setBaseline(song.lyricsText||'');},[song.lyricsText]);
 useEffect(()=>{try{localStorage.setItem(key,text);}catch{}},[key,text]);
 useEffect(()=>{onDraftChange?.(text);},[text,onDraftChange]);
 async function save(refine:boolean){if(refine&&!text.trim())return;setBusy(true);onBusyChange?.(true);setStatus('');try{if(refine){const job=await api<Job>(`/songs/${song.id}/lyrics/align`,{method:'POST',body:JSON.stringify({revision:song.revision,lyricsText:text})});onJob(job);setStatus('已提交歌词校对，请在下方审阅草稿。应用前不会修改工程。');}else{const current=await patchSong(song,{lyricsText:text});onSongChange(current);setBaseline(text);setStatus('手动歌词已保存。');}}catch(error){onError((error as Error).message);}finally{setBusy(false);onBusyChange?.(false);}}
 return <section className="card lyrics-input-card"><div className="section-header"><div><h2><AlignLeft size={19}/>手动歌词与断句</h2><p className="muted">粘贴你确认的歌词，每行代表一句。无需曲名、演唱者或段落标题。模型根据这些文字重新挂接歌词和划分乐句，结果先保存成可审阅草稿。</p></div><span className="badge">{text.split(/\n/).filter(s=>s.trim()).length} 句</span></div><label>准确歌词<textarea aria-label="手动输入准确歌词，每行一句" rows={7} maxLength={20000} value={text} placeholder={'在这里输入准确歌词\n每行一句，按你的练习需要断句'} onChange={event=>{setText(event.target.value);setStatus('');}}/></label><div className="actions" style={{marginTop:12,flexWrap:'wrap'}}><button disabled={busy||disabled||text===(song.lyricsText||'')} onClick={()=>void save(false)}><Save size={15}/>保存手动歌词</button><button className="primary" disabled={busy||disabled||!text.trim()||!song.score.notes.length} onClick={()=>void save(true)}><ScanLine size={15}/>{busy?'正在提交…':'按手动歌词校对断句'}</button><button disabled={busy} onClick={()=>{setText(song.score.phrases.map(p=>song.score.notes.filter(n=>n.phraseId===p.id).map(n=>n.lyric).join('')).filter(Boolean).join('\n'));setStatus('已载入当前识别歌词作为编辑起点，请先纠正其中的错误。');}}>载入当前谱面歌词</button><button disabled={busy} onClick={()=>{setText(song.lyricsText||'');setStatus('已恢复服务器保存的歌词。');}}><RotateCcw size={14}/>恢复已保存</button></div><p className="hint">输入草稿会暂存于当前浏览器。保存后的手动歌词也会用于后续谱图识别。歌词校对不会改变音高和时值；节奏问题请使用逐行识谱或谱面编辑。</p>{!song.score.notes.length&&<p className="notice">先保存歌词，再上传谱图开始识谱；已有音符后可单独校对断句。</p>}{status&&<p className="success-text" role="status">{status}</p>}</section>;
}
