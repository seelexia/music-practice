import {Archive,ArrowRight,Heart,Trash2} from 'lucide-react';
import type {Song} from '../types';
import SongInfo from './SongInfo';
import './wishlist.css';

type Props={song:Song;dirty:boolean;busy:boolean;onSongChange:(song:Song)=>void;onError:(message:string)=>void;onDirtyChange:(dirty:boolean)=>void;onComplete:()=>void;onArchive:()=>void;onDelete:()=>void};
export default function WishlistSong({song,dirty,busy,onSongChange,onError,onDirtyChange,onComplete,onArchive,onDelete}:Props){
 const cover=song.assets.find(asset=>asset.id===song.coverId);
 return <section className="wishlist-detail" aria-label="愿望歌曲资料">
  <header className="card wishlist-hero"><div className="wishlist-art">{cover?<img src={cover.url} alt={`${song.title}封面`}/>:<Heart size={38}/>}</div><div className="wishlist-intro"><span className="eyebrow">SOMEDAY, YOUR MELODY</span><h1>{song.title}</h1><p>{song.artist||'先记住喜欢的歌，资料可以慢慢填。'}</p><span className="wishlist-badge"><Heart size={12}/>{song.archived?'已归档的愿望':'愿望单'}</span></div><div className="wishlist-actions">{!song.archived&&<><button className="primary" disabled={busy||dirty} onClick={onComplete}>开始补全<ArrowRight size={16}/></button><small>{dirty?'请先保存资料，再开始补全。':'保留这首歌的资料，继续添加谱图与音频。'}</small></>}<button disabled={busy} onClick={onArchive}><Archive size={14}/>{song.archived?'恢复至愿望单':'归档愿望'}</button>{song.archived&&<button className="danger-text" disabled={busy} onClick={onDelete}><Trash2 size={14}/>删除归档歌曲</button>}</div></header>
  <SongInfo key={song.id} song={song} onSongChange={onSongChange} onError={onError} onDirtyChange={onDirtyChange}/>
 </section>;
}
