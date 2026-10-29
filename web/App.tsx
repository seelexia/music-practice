import {useCallback,useEffect,useRef,useState} from 'react';
import {Music2,Library,Plus,Search,Settings,Headphones,SlidersHorizontal,Info,FolderOpen,Archive,ArrowLeft,ChevronRight,X,Disc3,ScanLine,Mic,AudioLines,Link2,Columns2,Trash2,Heart} from 'lucide-react';
import {api,patchSong} from './api';
import type {Song} from './types';
import PracticePanel,{StandalonePitchPanel,type PracticeHandle} from './components/PracticePanel';
import ScoreView,{type LoopRange} from './components/ScoreView';
import ScoreEditor from './components/ScoreEditor';
import SongInfo from './components/SongInfo';
import AssetsPanel from './components/AssetsPanel';
import ScorePromptTools from './components/ScorePromptTools';
import RecognitionPanel from './components/RecognitionPanel';
import SettingsPanel from './components/SettingsPanel';
import LibraryOverview from './components/LibraryOverview';
import WishlistSong from './components/WishlistSong';
import {filterLibrarySongs,isWishlistSong,saveWishlist,wishlistCompletion} from './library';

const pendingWishKey='shengjian.pendingWishlistSongId';
function readPendingWish(){try{return localStorage.getItem(pendingWishKey)||'';}catch{return '';}}

type Tab='practice'|'split'|'pitch'|'recognition'|'editor'|'recordings'|'alignment'|'info'|'assets';
const tabs=[['practice','练习',Headphones],['recognition','识谱',ScanLine],['editor','音符编辑',SlidersHorizontal],['alignment','原音对齐',Link2],['recordings','录音',Mic],['info','歌曲资料',Info],['assets','素材',FolderOpen]] as const;
function SongWorkspace({song,onSongChange,onError,tab,onDirtyChange,onTabChange,onRecordingBusyChange}:{song:Song;onSongChange:(s:Song)=>void;onError:(s:string)=>void;tab:Tab;onDirtyChange:(dirty:boolean)=>void;onTabChange:(tab:Tab)=>void;onRecordingBusyChange:(busy:boolean)=>void}){
  const practice=useRef<PracticeHandle>(null);const [beat,setBeat]=useState(-1);const [dirty,setDirty]=useState(false);const [infoDirty,setInfoDirty]=useState(false);const [preRoll,setPreRoll]=useState(1);const [loopRange,setLoopRange]=useState<LoopRange|null>(null);const [selectedNote,setSelectedNote]=useState<string|null>(null);
  const markDirty=useCallback((value:boolean)=>setDirty(value),[]);
  useEffect(()=>{onDirtyChange(dirty||infoDirty);return ()=>onDirtyChange(false);},[dirty,infoDirty,onDirtyChange]);
  useEffect(()=>()=>onRecordingBusyChange(false),[onRecordingBusyChange]);
  const audioView=tab==='recordings'||tab==='alignment'||tab==='pitch'||tab==='split'?tab:'practice';
  const audioVisible=['practice','split','pitch','recordings','alignment'].includes(tab);
  const loopChanged=useCallback((start:number,end:number,enabled:boolean)=>setLoopRange({start,end,enabled}),[]);
  return <><div hidden={!audioVisible}>{['practice','split','pitch'].includes(tab)&&<div className="practice-view-switch"><span>练习视图</span><div className="segmented">{([['practice','谱面',Music2],['split','谱面 + 音高',Columns2],['pitch','音高',AudioLines]] as const).map(([view,label,Icon])=><button key={view} className={tab===view?'active':''} onClick={()=>onTabChange(view)}><Icon size={14}/>{label}</button>)}</div></div>}<PracticePanel ref={practice} song={song} onSongChange={onSongChange} onError={onError} onPositionChange={setBeat} onRecordingBusyChange={onRecordingBusyChange} workspaceView={audioView} selectedNoteId={selectedNote} onLoopChange={loopChanged}><ScoreView song={song} selectedNoteId={tab==='alignment'?selectedNote:null} beat={beat} onSeek={b=>{if(tab!=='alignment')practice.current?.playFromBeat(b,preRoll);}} onPhraseSeek={id=>practice.current?.seekPhrase(id)} onNoteSelect={setSelectedNote} preRoll={preRoll} onPreRollChange={setPreRoll} loopRange={loopRange} onLoopChange={(start,end,enabled)=>{setLoopRange({start,end,enabled});practice.current?.setLoopRange(start,end,enabled);}}/></PracticePanel></div><div hidden={tab!=='recognition'}><RecognitionPanel song={song} onSongChange={onSongChange} onError={onError} hasLocalEdits={dirty}/></div><div hidden={tab!=='editor'}><ScoreEditor song={song} onSongChange={onSongChange} onError={onError} onDirtyChange={markDirty}/></div><div hidden={tab!=='info'}><SongInfo song={song} onSongChange={onSongChange} onError={onError} onDirtyChange={setInfoDirty}/></div><div hidden={tab!=='assets'}><AssetsPanel song={song} onSongChange={onSongChange} onError={onError} onOpenImport={()=>onTabChange('recognition')}/></div></>;
}
type Screen='overview'|'song'|'settings'|'pitch';
export default function App(){
 const [screen,setScreen]=useState<Screen>('overview');
 const [songs,setSongs]=useState<Song[]>([]),[selected,setSelected]=useState(''),[tab,setTab]=useState<Tab>('practice');
 const [archived,setArchived]=useState(false),[wishlist,setWishlist]=useState(false),[search,setSearch]=useState(''),[selectedTags,setSelectedTags]=useState<string[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[dirty,setDirty]=useState(false);
 const [recordingBusy,setRecordingBusy]=useState(false);
 const [libraryBulkBusy,setLibraryBulkBusy]=useState(false);
 const [creating,setCreating]=useState(false),[title,setTitle]=useState(''),[artist,setArtist]=useState(''),[busy,setBusy]=useState(false);
 const [creatingWish,setCreatingWish]=useState(false),[pendingWishId,setPendingWishId]=useState(readPendingWish);
 const [deleteTarget,setDeleteTarget]=useState<Song|null>(null),[deleting,setDeleting]=useState(false),[manageBusyId,setManageBusyId]=useState(''),[trashVersion,setTrashVersion]=useState(0);
 const visibleSongs=songs.filter(song=>song.id!==pendingWishId);
 const song=songs.find(s=>s.id===selected),filtered=filterLibrarySongs(visibleSongs,{archived,wishlist,query:search,tags:selectedTags});
 const onError=useCallback((message:string)=>setError(message),[]);
 const updateSong=useCallback((next:Song)=>setSongs(old=>old.some(s=>s.id===next.id)?old.map(s=>s.id===next.id?next:s):[next,...old]),[]);
 async function load(){setLoading(true);try{setSongs(await api<Song[]>('/songs'));}catch(e){onError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 useEffect(()=>{const handle=(e:BeforeUnloadEvent)=>{if(dirty||recordingBusy||libraryBulkBusy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handle);return()=>window.removeEventListener('beforeunload',handle);},[dirty,recordingBusy,libraryBulkBusy]);
 function recordingBlocksLeave(){if(!recordingBusy)return false;setNotice('请先停止录音并等待保存，再离开歌曲。');return true;}
 function bulkBlocksLeave(){if(!libraryBulkBusy)return false;setNotice('批量操作正在进行，请等待完成后再切换页面。');return true;}
 function canLeave(){return !bulkBlocksLeave()&&!recordingBlocksLeave()&&(!dirty||window.confirm('当前谱面或资料有未保存的修改。离开后会丢弃这些修改，仍然继续吗？'));}
 function openCreate(){if(!bulkBlocksLeave()&&!recordingBlocksLeave()){setCreatingWish(false);setCreating(true);}}
 function openWishCreate(){if(!bulkBlocksLeave()&&!recordingBlocksLeave()){setCreatingWish(true);setCreating(true);}}
 function rememberWish(id:string){setPendingWishId(id);try{if(id)localStorage.setItem(pendingWishKey,id);else localStorage.removeItem(pendingWishKey);}catch{/* The in-memory ID still protects retries when local storage is unavailable. */}}
 function showOverview(nextArchived:boolean,nextWishlist=false){setScreen('overview');setSelected('');setDirty(false);setRecordingBusy(false);setArchived(nextArchived);setWishlist(nextWishlist);setSearch('');setSelectedTags([]);setError('');setNotice('');}
 function openOverview(nextArchived=false,nextWishlist=false){if(!canLeave())return;showOverview(nextArchived,nextWishlist);}
 function choose(id:string){if(screen==='song'&&id===selected)return;if(!canLeave())return;const next=songs.find(s=>s.id===id);if(!next)return;setSelected(id);setScreen('song');setArchived(next.archived);setWishlist(isWishlistSong(next));setTab('practice');setDirty(false);setError('');setNotice('');}
 function openSettings(){if(!canLeave())return;setScreen('settings');setDirty(false);setError('');setNotice('');}
 function openPitch(){if(!canLeave())return;setScreen('pitch');setDirty(false);setError('');setNotice('');}
 async function create(){
  if((!title.trim()&&!(creatingWish&&pendingWishId))||!canLeave())return;setBusy(true);
  try{const input={title:title.trim(),artist:artist.trim()},created=creatingWish?await saveWishlist(input,pendingWishId,rememberWish,{create:input=>api<Song>('/songs',{method:'POST',body:JSON.stringify(input)}),read:id=>api<Song>(`/songs/${id}`),patch:patchSong}):await api<Song>('/songs',{method:'POST',body:JSON.stringify(input)});if(creatingWish)rememberWish('');updateSong(created);setSelected(created.id);setScreen('song');setDirty(false);setCreating(false);setTitle('');setArtist('');setTab('assets');setArchived(created.archived);setWishlist(creatingWish);setSearch('');setSelectedTags([]);setError('');setNotice('');}catch(e){onError((e as Error).message);}finally{setBusy(false);}
 }
 async function completeWish(target:Song){
  if(dirty||target.archived||!canLeave())return;setManageBusyId(target.id);
  try{const updated=await patchSong(target,wishlistCompletion(target));updateSong(updated);setWishlist(false);setTab('assets');setDirty(false);setNotice('已移入我的曲库，继续添加谱图与音频。');}catch(e){onError((e as Error).message);}finally{setManageBusyId('');}
 }
 async function toggleArchive(target:Song){
  if(!canLeave())return;setManageBusyId(target.id);
  try{const updated=await patchSong(target,{archived:!target.archived});updateSong(updated);showOverview(updated.archived,isWishlistSong(updated));setNotice(`${updated.title} 已${updated.archived?'归档':isWishlistSong(updated)?'恢复至愿望单':'恢复至曲库'}。`);}catch(e){onError((e as Error).message);}finally{setManageBusyId('');}
 }
 function requestDelete(target:Song){if(!target.archived||!canLeave())return;setDeleteTarget(target);}
 async function deleteSong(){
  if(!deleteTarget)return;const target=deleteTarget;setDeleting(true);
  try{await api<Song>(`/songs/${target.id}/delete`,{method:'POST',body:JSON.stringify({revision:target.revision})});setSongs(old=>old.filter(s=>s.id!==target.id));if(selected===target.id)showOverview(true);setTrashVersion(value=>value+1);setDeleteTarget(null);setNotice(`${target.title} 已移入回收站，可在归档歌曲下方恢复。`);}catch(e){onError((e as Error).message);}finally{setDeleting(false);}
 }
 function restored(next:Song){updateSong(next);setNotice(`${next.title} 已恢复至归档歌曲。`);}
 return <div className="app-shell">
  <aside className="sidebar">
   <a href="#" className="brand" onClick={e=>{e.preventDefault();openOverview(false);}}><span className="brand-icon"><Music2 size={25}/></span><span>声笺<small>A LITTLE CLOSER TO MUSIC</small></span></a>
   <div className="sidebar-section"><span>我的空间</span><button title="新建歌曲" onClick={openCreate}><Plus size={17}/></button></div>
   <button aria-label="我的曲库" className={`nav-link ${['overview','song'].includes(screen)&&!archived&&!wishlist?'active':''}`} onClick={()=>openOverview(false)}><Library size={18}/>我的曲库<span>{filterLibrarySongs(visibleSongs,{archived:false}).length}</span></button>
   <button aria-label="愿望单" className={`nav-link ${['overview','song'].includes(screen)&&!archived&&wishlist?'active':''}`} onClick={()=>openOverview(false,true)}><Heart size={18}/>愿望单<span>{filterLibrarySongs(visibleSongs,{archived:false,wishlist:true}).length}</span></button>
   <button aria-label="归档歌曲" className={`nav-link ${['overview','song'].includes(screen)&&archived?'active':''}`} onClick={()=>openOverview(true)}><Archive size={18}/>归档歌曲<span>{filterLibrarySongs(visibleSongs,{archived:true}).length}</span></button>
   <button className={`nav-link ${screen==='pitch'?'active':''}`} onClick={openPitch}><AudioLines size={18}/>独立音高</button>
   <div className="library-search"><Search size={15}/><input disabled={libraryBulkBusy} aria-label={wishlist&&!archived?'搜索愿望单':'搜索曲库'} placeholder="寻找一首歌…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
   <div className="song-list">{filtered.map(s=>{const cover=s.assets.find(a=>a.id===s.coverId);return <button className={`song-item ${s.id===selected&&screen==='song'?'active':''}`} key={s.id} onClick={()=>choose(s.id)}><span className="song-thumb">{cover?<img src={cover.url} alt=""/>:isWishlistSong(s)?<Heart size={22}/>:<Disc3 size={22}/>}</span><span className="song-item-text"><b>{s.title}</b><small>{s.artist||'未填写歌手'}</small></span>{s.id===selected&&screen==='song'&&!isWishlistSong(s)&&<span className="playing-bars"><i/><i/><i/></span>}</button>;})}{!filtered.length&&!loading&&<p className="sidebar-empty">{search||selectedTags.length?'没有找到匹配的歌曲':archived?'暂无归档歌曲':wishlist?'先记下想唱的歌。':'你的第一首歌，等你放进来。'}</p>}</div>
   <button className="new-song" onClick={wishlist&&!archived?openWishCreate:openCreate}><Plus size={17}/>{wishlist&&!archived?'添加愿望':'添加歌曲'}</button>
   <div className="sidebar-bottom"><button className={`nav-link ${screen==='settings'?'active':''}`} onClick={openSettings}><Settings size={18}/>设置</button><div className="local-status"><span className="status-dot"/>本地音乐工作台<small>一点一点，唱进旋律里。</small></div></div>
  </aside>
  <main className="main-content">
   <header className="topbar"><div><span>我的空间</span><ChevronRight size={13}/><b>{screen==='settings'?'设置':screen==='pitch'?'独立音高':screen==='song'?song?.title:archived?'归档歌曲':wishlist?'愿望单':'我的曲库'}</b></div><div className="mobile-actions"><button aria-label="我的曲库" onClick={()=>openOverview(false)}><Library size={16}/></button><button aria-label="愿望单" onClick={()=>openOverview(false,true)}><Heart size={16}/><span className="nav-count">{filterLibrarySongs(visibleSongs,{archived:false,wishlist:true}).length}</span></button><button aria-label="独立音高" onClick={openPitch}><AudioLines size={16}/></button><button aria-label="添加歌曲" onClick={openCreate}><Plus size={16}/></button><button aria-label="归档曲库" onClick={()=>openOverview(true)}><Archive size={16}/></button><button aria-label="设置" onClick={openSettings}><Settings size={16}/></button></div><span className="topbar-tip"><span className="status-dot"/>LOCAL WORKSPACE</span></header>
   <div className="page-content">
    {error&&<div className="error-banner" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="关闭错误提示"><X size={17}/></button></div>}
    {notice&&<div className="app-notice" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={()=>setNotice('')}><X size={15}/></button></div>}
    {pendingWishId&&!creating&&<div className="notice warning wishlist-pending" role="status"><span>有一首歌曲已创建，尚未完成加入愿望单。</span><button onClick={openWishCreate}>继续加入愿望单</button></div>}
    {screen==='settings'?<SettingsPanel onError={onError}/>:screen==='pitch'?<StandalonePitchPanel onError={onError}/>:loading?<div className="empty"><Disc3 className="spin"/><h2>正在打开曲库…</h2></div>:screen==='song'&&song?<>
     <button className="song-return-button" onClick={()=>openOverview(song.archived,isWishlistSong(song))}><ArrowLeft size={14}/>返回{song.archived?'归档歌曲':isWishlistSong(song)?'愿望单':'我的曲库'}</button>
     {isWishlistSong(song)?<WishlistSong song={song} dirty={dirty} busy={!!manageBusyId} onSongChange={updateSong} onError={onError} onDirtyChange={setDirty} onComplete={()=>void completeWish(song)} onArchive={()=>void toggleArchive(song)} onDelete={()=>requestDelete(song)}/>:<>
     <section className="song-hero"><div className="hero-cover">{song.assets.find(a=>a.id===song.coverId)?<img src={song.assets.find(a=>a.id===song.coverId)!.url} alt={`${song.title}封面`}/>:<><div className="cover-orbit"/><Music2 size={54}/><span>声笺 · SONG NOTES</span></>}</div><div className="hero-info"><div className="eyebrow">YOUR NEXT MELODY <span>/{String(songs.findIndex(s=>s.id===song.id)+1).padStart(2,'0')}</span></div><h1>{song.title}</h1><p className="hero-artist">{song.artist||'等待填写的歌手'}{song.album&&<><span>·</span>{song.album}</>}</p><div className="hero-badges"><span><Music2 size={13}/>{song.score.key} 调</span><span>{song.score.bpm} BPM</span><span>{song.score.notes.length} 个音符</span><span className={song.score.status==='corrected'?'green':''}>{song.score.status==='corrected'?'人工校对':song.score.notes.length?'待核对谱面':'等待谱图'}</span>{song.archived&&<span>已归档</span>}</div><p className="hero-description">{song.description||'留一点时间给喜欢的歌，从一句旋律开始今天的练习。'}</p></div><div className="hero-actions"><button onClick={()=>setTab('recognition')}><ScanLine size={16}/>识谱与校对</button><button disabled={!!manageBusyId} className="text-button" onClick={()=>void toggleArchive(song)}><Archive size={14}/>{song.archived?'恢复至曲库':'归档歌曲'}</button>{song.archived&&<button className="text-button danger-text" onClick={()=>requestDelete(song)}><Trash2 size={14}/>删除归档歌曲</button>}</div></section>
     <nav className="workspace-tabs" aria-label="歌曲工作台">{tabs.map(([id,label,Icon])=><button key={id} onClick={()=>setTab(id)} className={tab===id?'active':''}><Icon size={17}/>{label}{id==='editor'&&dirty&&<i className="unsaved-dot"/>}</button>)}<span>工程版本 v{song.revision}</span></nav>
     <SongWorkspace key={song.id} song={song} tab={tab} onSongChange={updateSong} onError={onError} onDirtyChange={setDirty} onTabChange={setTab} onRecordingBusyChange={setRecordingBusy}/>
     </>}
    </>:<LibraryOverview songs={visibleSongs} archived={archived} wishlist={wishlist} query={search} onQueryChange={setSearch} selectedTags={selectedTags} onTagsChange={setSelectedTags} onChoose={choose} onCreate={wishlist?openWishCreate:openCreate} onArchive={target=>void toggleArchive(target)} onDelete={requestDelete} onRestored={restored} onError={onError} trashVersion={trashVersion} busyId={manageBusyId} onBatchUpdate={updateSong} onBatchDeleted={ids=>{setSongs(old=>old.filter(song=>!ids.includes(song.id)));setTrashVersion(value=>value+1);}} onBusyChange={setLibraryBulkBusy}/>}
    <footer>声笺 <span>·</span> 留下声音，也留下每一次进步。</footer>
   </div>
  </main>
  {creating&&<div className="modal-backdrop" onClick={()=>!busy&&setCreating(false)}><section className="modal card" role="dialog" aria-modal="true" aria-labelledby="create-title" onClick={e=>e.stopPropagation()}><div className="section-header"><h2 id="create-title">{creatingWish?'记下一首想唱的歌':'添加一首新歌'}</h2><button disabled={busy} onClick={()=>setCreating(false)} aria-label="关闭"><X size={19}/></button></div><p className="muted">{creatingWish?'只填歌名即可收藏。歌手、链接和其他资料可以慢慢补充，准备好后再开始补全。':'先给它一个名字，接着就能添加谱图与音频，也可导入外部工具转录的 JSON。'}</p>{!creatingWish&&<ScorePromptTools disabled={busy}/>}<form onSubmit={e=>{e.preventDefault();void create();}}>{creatingWish&&pendingWishId?<p className="notice warning">歌曲已创建，愿望单分类尚未完成<br/>重试会继续保存同一首歌，不会重复创建。{error&&<span role="alert">{error}</span>}</p>:<><label>歌曲名称<input autoFocus required maxLength={300} value={title} onChange={e=>setTitle(e.target.value)} placeholder="想唱哪首歌？"/></label><label>歌手<input maxLength={300} value={artist} onChange={e=>setArtist(e.target.value)} placeholder="选填"/></label></>}<button type="submit" className="primary" disabled={busy||(!title.trim()&&!(creatingWish&&pendingWishId))}>{busy?'保存中…':creatingWish?pendingWishId?'重试加入愿望单':'加入愿望单':'创建并添加素材'}<ChevronRight size={16}/></button></form></section></div>}
  {deleteTarget&&<div className="modal-backdrop"><section className="modal card song-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-song-title"><div className="section-header"><h2 id="delete-song-title">删除归档歌曲？</h2><button disabled={deleting} aria-label="取消删除歌曲" onClick={()=>setDeleteTarget(null)}><X size={19}/></button></div><p>“{deleteTarget.title}”将从归档列表移入回收站。谱图、音频、录音和修改历史保留在本机，可从回收站恢复。</p><div className="actions"><button disabled={deleting} onClick={()=>setDeleteTarget(null)}>取消</button><button className="danger" disabled={deleting} onClick={()=>void deleteSong()}>{deleting?'正在删除…':'确认删除歌曲'}</button></div></section></div>}
 </div>;
}
