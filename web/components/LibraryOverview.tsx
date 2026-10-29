import {useEffect,useState} from 'react';
import {Archive,ArrowUpRight,Disc3,Heart,Plus,RotateCcw,Search,Tag,Trash2,X} from 'lucide-react';
import type {Song} from '../types';
import {api,patchSong} from '../api';
import {batchTags,parseBatchTags,runLibraryBatch,type BatchFailure} from '../library-batch';
import {filterLibrarySongs,isWishlistSong,libraryTags,metadataTags,tagKey,userSongTags,WISHLIST_TAG} from '../library';
import './library.css';

type Props={songs:Song[];archived:boolean;wishlist?:boolean;query:string;onQueryChange:(value:string)=>void;selectedTags:string[];onTagsChange:(tags:string[])=>void;onChoose:(id:string)=>void;onCreate:()=>void;onArchive:(song:Song)=>void;onDelete:(song:Song)=>void;onRestored:(song:Song)=>void;onError:(message:string)=>void;trashVersion:number;busyId?:string;onBatchUpdate:(song:Song)=>void;onBatchDeleted:(ids:string[])=>void;onBusyChange:(busy:boolean)=>void};

export default function LibraryOverview({songs,archived,wishlist=false,query,onQueryChange,selectedTags,onTagsChange,onChoose,onCreate,onArchive,onDelete,onRestored,onError,trashVersion,busyId,onBatchUpdate,onBatchDeleted,onBusyChange}:Props){
 const [trash,setTrash]=useState<Song[]>([]),[trashLoading,setTrashLoading]=useState(false),[restoring,setRestoring]=useState('');
 const matching=filterLibrarySongs(songs,{archived,wishlist,query,tags:selectedTags}),total=filterLibrarySongs(songs,{archived,wishlist}).length,availableTags=libraryTags(songs,archived,wishlist);
 const hasFilters=!!query.trim()||selectedTags.length>0;
 const [managing,setManaging]=useState(false),[selection,setSelection]=useState<Record<string,Song>>({});
 const [batchBusy,setBatchBusy]=useState(false),[done,setDone]=useState(0),[batchTotal,setBatchTotal]=useState(0),[tagInput,setTagInput]=useState('');
 const [batchMessage,setBatchMessage]=useState(''),[failures,setFailures]=useState<BatchFailure[]>([]),[deleteTargets,setDeleteTargets]=useState<Song[]|null>(null);
 const context=JSON.stringify([archived,wishlist,tagKey(query),...selectedTags.map(tagKey).sort()]);
 const selected=matching.filter(song=>Object.hasOwn(selection,song.id)).map(song=>selection[song.id]);
 const locked=batchBusy||!!busyId||!!restoring;
 useEffect(()=>{setSelection({});setDeleteTargets(null);setFailures([]);setBatchMessage('');},[context]);
 useEffect(()=>{setManaging(false);},[archived,wishlist]);
 useEffect(()=>{onBusyChange(batchBusy);return()=>onBusyChange(false);},[batchBusy,onBusyChange]);
 function toggleSelected(song:Song){setSelection(old=>{const next={...old};if(Object.hasOwn(next,song.id))delete next[song.id];else next[song.id]=song;return next;});setBatchMessage('');}
 function toggleManaging(){setManaging(value=>!value);setSelection({});setFailures([]);setBatchMessage('');setDeleteTargets(null);}
 async function executeBatch(action:'archive'|'restore'|'add-tags'|'remove-tags'|'delete',targets=selected){
  if(locked||!targets.length)return;let tags:string[]=[];
  try{if(action==='add-tags'||action==='remove-tags'){tags=parseBatchTags(tagInput);if(tags.some(tag=>tagKey(tag)===tagKey(WISHLIST_TAG)))throw new Error('愿望单是歌曲分类，请在愿望单中添加歌曲或点击开始补全。');}}catch(error){setBatchMessage((error as Error).message);return;}
  if(action==='delete'&&targets.some(song=>!song.archived)){setBatchMessage('只能将已归档的歌曲移入回收站');return;}
  setBatchBusy(true);setDone(0);setBatchTotal(targets.length);setFailures([]);setBatchMessage('');setDeleteTargets(null);
  try{
   const result=await runLibraryBatch(targets,async song=>action==='delete'?api<Song>(`/songs/${song.id}/delete`,{method:'POST',body:JSON.stringify({revision:song.revision})}):patchSong(song,action==='archive'?{archived:true}:action==='restore'?{archived:false}:{tags:metadataTags(song,batchTags(userSongTags(song.tags),tags,action==='add-tags'?'add':'remove'))}),setDone);
   if(action==='delete')onBatchDeleted(result.succeeded.map(song=>song.id));else result.succeeded.forEach(onBatchUpdate);
   setSelection(Object.fromEntries(result.failed.map(item=>[item.song.id,item.song])));setFailures(result.failed);
   setBatchMessage(`已完成 ${result.succeeded.length} 首${result.failed.length?`；${result.failed.length} 首未完成，仍保留选中`:''}。`);
  }finally{setBatchBusy(false);}
 }
 async function refreshFailed(){
  if(locked||!failures.length)return;setBatchBusy(true);setDone(0);setBatchTotal(failures.length);
  try{const result=await runLibraryBatch(failures.map(item=>item.song),song=>api<Song>(`/songs/${song.id}`),setDone);result.succeeded.forEach(onBatchUpdate);setSelection(Object.fromEntries(result.succeeded.filter(song=>song.archived===archived&&!song.deletedAt).map(song=>[song.id,song])));setFailures(result.failed);setBatchMessage(`已重新读取 ${result.succeeded.length} 首歌曲，请核对后重试所需操作。`);}finally{setBatchBusy(false);}
 }
 useEffect(()=>{
  if(!archived)return;let disposed=false;setTrashLoading(true);
  api<Song[]>('/trash').then(value=>{if(!disposed)setTrash(value);}).catch(error=>{if(!disposed)onError(error.message);}).finally(()=>{if(!disposed)setTrashLoading(false);});
  return()=>{disposed=true;};
 },[archived,trashVersion,onError]);
 function toggleTag(name:string){const key=tagKey(name);onTagsChange(selectedTags.some(t=>tagKey(t)===key)?selectedTags.filter(t=>tagKey(t)!==key):[...selectedTags,name]);}
 function clear(){onQueryChange('');onTagsChange([]);}
 async function restore(song:Song){setRestoring(song.id);try{const updated=await api<Song>(`/trash/${song.id}/restore`,{method:'POST',body:JSON.stringify({revision:song.revision})});setTrash(old=>old.filter(s=>s.id!==song.id));onRestored(updated);}catch(error){onError((error as Error).message);}finally{setRestoring('');}}
 return <section className={`library-overview ${wishlist&&!archived?'wishlist-overview':''}`} aria-label={archived?'归档歌曲总览':wishlist?'愿望单总览':'我的曲库总览'}>
  <div className="library-overview-heading"><div><span className="eyebrow">{archived?'SAVED FOR LATER':wishlist?'SOMEDAY, YOUR MELODY':'YOUR MUSIC LIBRARY'}</span><h1>{archived?'归档歌曲':wishlist?'愿望单':'我的曲库'}</h1><p>{archived?'暂时收起的歌，随时可以重新唱。删除后可在下方回收站恢复。':wishlist?'先记下想唱的歌和资料，准备好后再添加谱图与音频。':'收藏、查找并打开一首歌，开始今天的练习。'}</p></div>{!archived&&<button className="primary" onClick={onCreate}><Plus size={17}/>{wishlist?'添加愿望':'添加歌曲'}</button>}</div>
  <div className="card library-filter-card"><div className="overview-search"><Search size={19}/><input disabled={locked} aria-label="总览关键词搜索" value={query} onChange={event=>onQueryChange(event.target.value)} placeholder="搜索歌名、歌手、专辑、标签…"/>{query&&<button disabled={locked} aria-label="清空关键词" onClick={()=>onQueryChange('')}><X size={17}/></button>}</div>
   <div className="library-tag-filters"><span><Tag size={15}/>标签</span>{availableTags.length?availableTags.map(tag=><button disabled={locked} key={tagKey(tag.name)} aria-label={`筛选标签 ${tag.name}`} aria-pressed={selectedTags.some(t=>tagKey(t)===tagKey(tag.name))} className={selectedTags.some(t=>tagKey(t)===tagKey(tag.name))?'selected':''} onClick={()=>toggleTag(tag.name)}>{tag.name}<small>{tag.count}</small></button>):<small>在歌曲资料中添加标签后，可在这里筛选。</small>}</div>
   <div className="library-filter-summary"><span role="status">显示 {matching.length} / {total} 首歌曲{selectedTags.length>1?' · 同时匹配所选标签':''}</span><button disabled={locked||!hasFilters} onClick={clear}>清除筛选</button></div>
  </div>
  <div className="library-batch-entry"><button disabled={locked} aria-pressed={managing} onClick={toggleManaging}>{managing?'退出批量管理':'批量管理'}</button></div>
  {managing&&<section className="card library-batch-tools" aria-label="批量管理工具"><div className="actions"><b role="status">已选择 {selected.length} 首</b><button disabled={locked||!matching.length} onClick={()=>setSelection(Object.fromEntries(matching.map(song=>[song.id,song])))}>全选当前结果（{matching.length}）</button><button disabled={locked||!selected.length} onClick={()=>setSelection({})}>取消全选</button><button disabled={locked||!selected.length} onClick={()=>void executeBatch(archived?'restore':'archive')}>{archived?'批量恢复原分类':'批量归档'}</button>{archived&&<button className="danger-text" disabled={locked||!selected.length} onClick={()=>setDeleteTargets(selected)}>批量移入回收站</button>}</div><div className="batch-tag-editor"><label>批量标签<input aria-label="批量标签" value={tagInput} disabled={locked} onChange={event=>setTagInput(event.target.value)} placeholder="用逗号分隔，例如：练习，抒情"/></label><button disabled={locked||!selected.length||!tagInput.trim()} onClick={()=>void executeBatch('add-tags')}>添加标签</button><button disabled={locked||!selected.length||!tagInput.trim()} onClick={()=>void executeBatch('remove-tags')}>移除标签</button></div><p className="hint">只操作选中的歌曲；更改搜索或标签筛选会清空选择。删除仅移入可恢复的回收站。</p></section>}
  {(batchBusy||batchMessage||failures.length>0)&&<div className={`notice ${failures.length?'warning':''}`} role="status">{batchBusy?`正在处理 ${done} / ${batchTotal} 首，请稍候…`:batchMessage}{failures.length>0&&<><ul>{failures.map(item=><li key={item.song.id}>{item.song.title}：{item.message}</li>)}</ul><button disabled={locked} onClick={()=>void refreshFailed()}>重新读取未完成歌曲</button></>}</div>}
  {deleteTargets&&<div className="modal-backdrop"><section className="modal card song-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-delete-title"><h2 id="batch-delete-title">将 {deleteTargets.length} 首归档歌曲移入回收站？</h2><ul className="batch-confirm-list">{deleteTargets.map(song=><li key={song.id}>{song.title}</li>)}</ul><p>谱图、音频、录音和修改历史保留，可从回收站恢复。</p><div className="actions"><button onClick={()=>setDeleteTargets(null)}>取消</button><button className="danger" onClick={()=>void executeBatch('delete',deleteTargets)}>确认移入回收站</button></div></section></div>}
  {matching.length?<div className="library-card-grid">{matching.map(song=>{const cover=song.assets.find(asset=>asset.id===song.coverId);return <article className={`card library-song-card ${managing&&Object.hasOwn(selection,song.id)?'batch-selected':''}`} data-song-id={song.id} key={song.id}>{managing&&<label className="library-select-check"><input aria-label={`选择歌曲 ${song.title}`} type="checkbox" checked={Object.hasOwn(selection,song.id)} disabled={locked} onChange={()=>toggleSelected(song)}/>选择此歌</label>}<button disabled={locked} className="library-song-open" aria-label={`${managing?'选中或取消歌曲':'打开歌曲'} ${song.title}`} onClick={()=>managing?toggleSelected(song):onChoose(song.id)}><span className="library-card-cover">{cover?<img src={cover.url} alt="" loading="lazy"/>:isWishlistSong(song)?<Heart size={38}/>:<Disc3 size={44}/>}</span><span className="library-card-info"><b>{song.title}</b><span>{song.artist||'未填写歌手'}</span>{song.album&&<small>{song.album}</small>}<span className="library-card-tags">{userSongTags(song.tags).map((tag,index)=><i key={index}>{tag}</i>)}</span><small className="library-card-score">{isWishlistSong(song)?'愿望单 · 先收藏，慢慢补全':song.score.notes.length?`${song.score.notes.length} 个音符 · ${song.score.bpm} BPM`:'等待添加谱图与音频'}</small></span><ArrowUpRight className="library-open-icon" size={19}/></button><div className="library-card-actions"><button disabled={locked} onClick={()=>onArchive(song)}><Archive size={14}/>{archived?isWishlistSong(song)?'恢复至愿望单':'恢复至曲库':'归档'}</button>{archived&&<button className="danger-text" aria-label={`删除归档歌曲 ${song.title}`} disabled={locked} onClick={()=>onDelete(song)}><Trash2 size={14}/>删除</button>}</div></article>;})}</div>:<div className="card library-empty"><Disc3 size={38}/><h2>{hasFilters?'没有找到匹配的歌曲':archived?'暂无归档歌曲':wishlist?'记下第一首想唱的歌':'添加你的第一首歌'}</h2><p>{hasFilters?'试试其他关键词，或清除标签筛选。':archived?'归档后的歌曲会显示在这里。':wishlist?'只有歌名也没关系，先把它留在愿望单。':'上传谱图和音频，把喜欢的歌放进曲库。'}</p>{hasFilters?<button onClick={clear}>显示全部歌曲</button>:!archived&&<button className="primary" onClick={onCreate}><Plus size={16}/>{wishlist?'添加愿望':'添加歌曲'}</button>}</div>}
  {archived&&<details className="card library-trash"><summary><span><Trash2 size={17}/>回收站</span><small>{trashLoading?'正在读取…':`${trash.length} 首`}</small></summary><p>删除的歌曲从曲库中移除，谱图、音频、录音和历史仍保存在本机。恢复后会回到归档歌曲。</p>{!trashLoading&&!trash.length&&<div className="trash-empty">回收站为空</div>}{trash.map(song=><div className="trash-row" key={song.id}><Disc3 size={24}/><div><b>{song.title}</b><small>{song.artist||'未填写歌手'}{song.deletedAt&&` · 删除于 ${new Date(song.deletedAt).toLocaleString('zh-CN')}`}</small></div><button aria-label={`恢复已删除歌曲 ${song.title}`} disabled={locked} onClick={()=>void restore(song)}><RotateCcw size={14}/>{restoring===song.id?'恢复中…':'恢复到归档'}</button></div>)}</details>}
 </section>;
}
