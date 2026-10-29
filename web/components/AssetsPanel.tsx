import {useRef,useState} from 'react';
import {Upload,ImagePlus,FileMusic,Film,Camera,Download} from 'lucide-react';
import type {Asset,Song} from '../types';
import {api,uploadAsset,downloadText} from '../api';
import {isAvifImage,prepareImageUpload} from '../image-import';
import {scoreLyricsText} from '../lyrics';
import {staffCompatibleMusicXml} from '../staff-playback';
import AssetManager from './AssetManager';
import ScorePromptTools from './ScorePromptTools';
type CaptureKind='score'|'cover';
export async function captureVideoFrame(video:HTMLVideoElement,name:string,kind:CaptureKind,onCapture:(file:File,kind:CaptureKind)=>Promise<void>){
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d')!.drawImage(video,0,0);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('截图失败')),'image/png'));
  await onCapture(new File([blob],`${name}-${video.currentTime.toFixed(1)}s.png`,{type:'image/png'}),kind);
}
function VideoAsset({asset,onCapture,onError}:{asset:Asset;onCapture:(file:File,kind:CaptureKind)=>Promise<void>;onError:(message:string)=>void}){
  const video=useRef<HTMLVideoElement>(null);const [busy,setBusy]=useState(false);
  async function capture(kind:CaptureKind){const v=video.current;if(!v||!v.videoWidth){onError('请先载入视频并定位到需要截取的画面');return;}setBusy(true);try{await captureVideoFrame(v,asset.name,kind,onCapture);}catch(error){onError((error as Error).message);}finally{setBusy(false);}}
  return <div className="asset-card"><video ref={video} controls preload="metadata" src={asset.url}/><div className="asset-caption"><span>{asset.name}</span><div className="actions"><button disabled={busy} onClick={()=>void capture('score')}><Camera size={14}/>截为谱图</button><button disabled={busy} onClick={()=>void capture('cover')}><Camera size={14}/>截为封面</button></div></div></div>;
}
export default function AssetsPanel({song,onSongChange,onError,onOpenImport}:{song:Song;onSongChange:(s:Song)=>void;onError:(s:string)=>void;onOpenImport?:()=>void}){
  const [busy,setBusy]=useState(false);const [status,setStatus]=useState('');const [coverUrl,setCoverUrl]=useState('');const [kind,setKind]=useState<Asset['kind']>('score');const input=useRef<HTMLInputElement>(null);
  const [exporting,setExporting]=useState(false);
  async function exportMusicXml(){if(exporting)return;setExporting(true);try{const response=await fetch(`/api/songs/${song.id}/export/musicxml`);if(!response.ok)throw new Error('五线谱导出失败，请稍后重试');downloadText(`${song.title}.musicxml`,staffCompatibleMusicXml(await response.text()),'application/vnd.recordare.musicxml+xml');}catch(error){onError((error as Error).message);}finally{setExporting(false);}}
  async function upload(files:FileList|File[]|null,assetKind=kind){
   if(!files?.length||busy)return;setBusy(true);let converted=0;
   try{
    for(const [index,file] of Array.from(files).entries()){
     const converting=(assetKind==='score'||assetKind==='cover')&&isAvifImage(file);
     setStatus(`${converting?'AVIF 转为 PNG':'上传'} ${index+1}/${files.length} · ${file.name}`);
     const prepared=await prepareImageUpload(file,assetKind);
     if(converting){converted++;setStatus(`上传 ${index+1}/${files.length} · ${prepared.name}（AVIF 原文件不变）`);}
     onSongChange(await uploadAsset(song.id,prepared,assetKind));
    }
    setStatus(converted?`上传完成，${converted} 个 AVIF 已转为 PNG；原文件不变`:'上传完成');
   }catch(e){onError((e as Error).message);setStatus('上传未完成，已成功的文件仍保留');}
   finally{setBusy(false);if(input.current)input.current.value='';}
  }
  return <><section className="card"><div className="section-header"><div><span className="eyebrow">SOURCE MATERIALS</span><h2>把这首歌的碎片放在一起</h2></div><span className="badge">{song.assets.length} 个文件</span></div><ScorePromptTools song={song} disabled={busy} onOpenImport={onOpenImport}/><div className="upload-options">{([['score','谱图',FileMusic],['audio','原音频',FileMusic],['video','视频',Film],['cover','封面',ImagePlus]] as const).map(([id,label,Icon])=><button className={kind===id?'active':''} disabled={busy} key={id} onClick={()=>setKind(id)}><Icon size={18}/>{label}</button>)}</div><div className={`dropzone ${busy?'busy':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)void upload(e.dataTransfer.files);}}><Upload size={28}/><h3>拖入文件，或从电脑中选择</h3><p>谱图与封面支持 PNG / JPG / WebP / AVIF · 音频 MP3 / WAV / OGG / WebM · 视频 MP4 / WebM · 单个不超过 100 MB</p>{(kind==='score'||kind==='cover')&&<p className="image-conversion-notice">AVIF 会在浏览器中按原尺寸转为无损 PNG 后上传，原文件不变；未提供图像或谱面给外部工具。</p>}<input ref={input} aria-label="上传歌曲素材文件" type="file" hidden multiple disabled={busy} accept={kind==='score'||kind==='cover'?'image/png,image/jpeg,image/webp,image/avif,.avif':kind==='video'?'video/mp4,video/webm':'audio/mpeg,audio/wav,audio/ogg,audio/webm'} onChange={e=>void upload(e.target.files)}/><button className="primary" disabled={busy} onClick={()=>input.current?.click()}><Upload size={16}/>{busy?'正在上传…':'选择文件'}</button><span className="hint" role="status">{status}</span></div><div className="cover-url"><label>从图片链接读取封面<input type="url" value={coverUrl} placeholder="音乐平台的公开封面图片链接" onChange={e=>setCoverUrl(e.target.value)}/></label><button disabled={busy||!coverUrl} onClick={async()=>{setBusy(true);try{onSongChange(await api<Song>(`/songs/${song.id}/cover-url`,{method:'POST',body:JSON.stringify({url:coverUrl})}));setCoverUrl('');}catch(e){onError((e as Error).message);}finally{setBusy(false);}}}>读取封面</button></div></section>
  <AssetManager song={song} onSongChange={onSongChange} onError={onError}/><div className="asset-grid">{song.assets.map(asset=>asset.kind==='video'?<VideoAsset key={asset.id} asset={asset} onError={onError} onCapture={async(file,destination)=>{await upload([file],destination);}}/>:<div className="asset-card" key={asset.id}>{['score','cover'].includes(asset.kind)?<a href={asset.url} target="_blank" rel="noreferrer"><img loading="lazy" src={asset.url} alt={asset.name}/></a>:<div className="audio-asset"><FileMusic size={32}/><audio controls preload="metadata" src={asset.url}/></div>}<div className="asset-caption"><div><b>{asset.name}</b><small>{({score:'谱图',cover:'封面',audio:'原音频',recording:'练习录音',video:'视频'})[asset.kind]} · {(asset.size/1024/1024).toFixed(2)} MB</small></div><a href={asset.url} download={asset.name} className="icon-button" aria-label={`下载${asset.name}`}><Download size={16}/></a></div></div>)}</div><section className="card export-card"><div><h3>带走你的练习成果</h3><p className="muted">工程 JSON 保存结构化资料与素材引用；完整备份还需复制服务的数据目录。</p></div><div className="actions">{[['midi','MIDI'],['project','工程 JSON']].map(([id,label])=><a className="button" key={id} href={`/api/songs/${song.id}/export/${id}`} download><Download size={14}/>{label}</a>)}<button disabled={exporting} onClick={()=>void exportMusicXml()}><Download size={14}/>{exporting?'正在导出…':'MusicXML'}</button><button onClick={()=>downloadText(`${song.title}-歌词.txt`,scoreLyricsText(song.score))}><Download size={14}/>歌词</button></div></section></>;
}
