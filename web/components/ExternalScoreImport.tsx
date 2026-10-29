import {useEffect,useMemo,useRef,useState} from 'react';
import {Copy,Download,FileJson,Upload} from 'lucide-react';
import {api,downloadText} from '../api';
import {externalTranscriptionPrompt,externalTranscriptionExample} from '../external-prompt';
import type {ExternalScorePrompt,Job,ScoreFormat,Song} from '../types';

const MAX_PACKAGE_BYTES=2*1024*1024;
type PackageSource={id:string;name?:string};
export default function ExternalScoreImport({song,disabled,onBusyChange,onJob}:{song:Song;disabled:boolean;onBusyChange:(busy:boolean)=>void;onJob:(job:Job)=>void}){
 const [format,setFormat]=useState<ScoreFormat|null>(null),[context,setContext]=useState<ExternalScorePrompt|null>(null);
 const [formatError,setFormatError]=useState(''),[promptError,setPromptError]=useState(''),[reload,setReload]=useState(0);
 const [text,setText]=useState(''),[mapping,setMapping]=useState<Record<string,string>>({}),[error,setError]=useState(''),[status,setStatus]=useState('');
 const [busy,setBusy]=useState(false),[copying,setCopying]=useState(false),[copyFallback,setCopyFallback]=useState(false);
 const fallback=useRef<HTMLTextAreaElement>(null);
 const images=song.assets.filter(asset=>asset.kind==='score');
 useEffect(()=>{
  let disposed=false;setFormatError('');setPromptError('');setContext(null);
  void api<ScoreFormat>('/score-format').then(value=>{if(!disposed)setFormat(value);}).catch(cause=>{if(!disposed)setFormatError((cause as Error).message);});
  void api<ExternalScorePrompt>(`/songs/${song.id}/external-prompt`).then(value=>{if(!disposed)setContext(value);}).catch(cause=>{if(!disposed)setPromptError((cause as Error).message);});
  return()=>{disposed=true;};
 },[song.id,song.revision,reload]);
 useEffect(()=>{if(copyFallback){fallback.current?.focus();fallback.current?.select();}},[copyFallback,context?.prompt]);
 const sources=useMemo(()=>{
  if(new Blob([text]).size>MAX_PACKAGE_BYTES)return [];
  try{
   const parsed=JSON.parse(text.replace(/^\uFEFF/,'')),seen=new Set<string>();
   if(!Array.isArray(parsed?.sources))return [];
   return parsed.sources.flatMap((source:unknown):PackageSource[]=>{
    if(!source||typeof source!=='object'||Array.isArray(source))return [];
    const {id,name}=source as {id?:unknown;name?:unknown};
    if(typeof id!=='string'||!id||seen.has(id))return [];
    seen.add(id);return [{id,...(typeof name==='string'?{name}:{})}];
   }).slice(0,100) as PackageSource[];
  }catch{return [];}
 },[text]);
 function sourceAsset(id:string){
  const assetId=Object.hasOwn(mapping,id)?mapping[id]:context?.manifest.find(source=>source.id===id)?.assetId;
  return images.some(image=>image.id===assetId)?assetId!:'';
 }
 async function copyPrompt(){
  if(!context)return;setCopying(true);setStatus('');
  try{await navigator.clipboard.writeText(externalTranscriptionPrompt(context.prompt));setCopyFallback(false);setStatus('本曲转谱提示词已复制，请将谱图与提示词一起交给外部工具。');}
  catch{setCopyFallback(true);setStatus('浏览器未允许自动复制。提示词已选中，请按 Ctrl+C（Mac 使用 ⌘C）复制。');requestAnimationFrame(()=>{fallback.current?.focus();fallback.current?.select();});}
  finally{setCopying(false);}
 }
 async function readFile(file:File){
  setError('');setStatus('');
  if(file.size>MAX_PACKAGE_BYTES){setError('外部转谱 JSON 不能超过 2 MB，请拆分内容后重试；原输入仍保留。');return;}
  try{setText(await file.text());setMapping({});}catch{setError('无法读取此文件，请重新选择 JSON 文件，或将内容粘贴到下方。');}
 }
 async function submit(){
  if(disabled||busy)return;setError('');setStatus('');
  if(new Blob([text]).size>MAX_PACKAGE_BYTES){setError('外部转谱 JSON 不能超过 2 MB，请拆分内容后重试。');return;}
  let sourcePackage:unknown;
  try{sourcePackage=JSON.parse(text.replace(/^\uFEFF/,''));}catch(cause){setError(`JSON 无法解析：${(cause as Error).message}。请粘贴完整 JSON，不要包含 Markdown 代码围栏。`);return;}
  if(!sourcePackage||typeof sourcePackage!=='object'||Array.isArray(sourcePackage)){setError('JSON 根节点必须是一个转谱包对象，请使用下载的示例模板。');return;}
  const sourceMapping=Object.fromEntries(sources.map(source=>[source.id,sourceAsset(source.id)] as const).filter(([,assetId])=>!!assetId));
  setBusy(true);onBusyChange(true);
  try{
   const job=await api<Job>(`/songs/${song.id}/import-score`,{method:'POST',body:JSON.stringify({revision:song.revision,package:sourcePackage,...(Object.keys(sourceMapping).length?{sourceMapping}:{})})});
   onJob(job);setStatus('外部转谱已保存为审核草稿。请在下方对照原图核对，再明确确认应用。');
  }catch(cause){setError((cause as Error).message);}
  finally{setBusy(false);onBusyChange(false);}
 }
 return <section className="card external-score-card" aria-labelledby="external-score-heading">
  <div className="section-header"><div><span className="eyebrow">PORTABLE SCORE</span><h2 id="external-score-heading"><FileJson size={20}/>外部转谱导入</h2><p className="muted">可让 Codex、Claude 或人工按统一格式转谱，再将 JSON 导入本曲。支持双行歌词，导入只生成审核草稿，格式校验不能证明音高与节奏准确。</p></div>{format&&<span className="badge">{format.format} v{format.version}</span>}</div>
  <div className="actions external-score-tools"><button disabled={!context||copying} onClick={()=>void copyPrompt()}><Copy size={15}/>{copying?'正在复制…':'复制本曲转谱提示词'}</button><button disabled={!format} onClick={()=>downloadText('shengjian-score.schema.json',JSON.stringify(format!.schema,null,2),'application/json')}><Download size={15}/>下载格式规范</button><button disabled={!format} onClick={()=>downloadText('shengjian-score.template.json',JSON.stringify(externalTranscriptionExample(format!.template),null,2),'application/json')}><Download size={15}/>下载示例模板</button></div>
  {(formatError||promptError)&&<div className="notice warning" role="alert">{formatError&&<p>格式资料读取失败：{formatError}</p>}{promptError&&<p>本曲提示词读取失败：{promptError}</p>}<button onClick={()=>setReload(value=>value+1)}>重新读取导入资料</button></div>}
  {copyFallback&&<label className="external-prompt-fallback">手动复制提示词<textarea ref={fallback} aria-label="可手动复制的转谱提示词" readOnly value={context?externalTranscriptionPrompt(context.prompt):''} rows={8} onFocus={event=>event.currentTarget.select()}/></label>}
  <p className="hint">提示词含当前可用谱图的来源清单；请自行向外部工具提供原图。没有上传谱图时也可导入外部转谱结果。导入过程不调用视觉模型。</p>
  <label className="external-file"><span><Upload size={15}/>选择 JSON 文件（最多 2 MB）</span><input aria-label="导入外部转谱 JSON 文件" type="file" accept="application/json,.json" disabled={busy} onChange={event=>{const file=event.currentTarget.files?.[0];if(file)void readFile(file);event.currentTarget.value='';}}/></label>
  <label>或粘贴转谱包<textarea aria-label="外部转谱 JSON" rows={9} spellCheck={false} value={text} disabled={busy} placeholder={'{\n  "format": "shengjian.score",\n  "version": 1,\n  ...\n}'} onChange={event=>{setText(event.target.value);setError('');setStatus('');}}/></label>
  {!!sources.length&&!!images.length&&<details className="external-source-mapping"><summary>关联本曲谱图（可选）</summary><p className="hint">只关联本曲已上传的谱图；不关联时仍可审核导入，来源名称会保留在原包中。</p>{sources.map(source=><label key={source.id}>{source.name||source.id} · {source.id}<select aria-label={`来源 ${source.id} 对应谱图`} value={sourceAsset(source.id)} disabled={busy} onChange={event=>{setMapping(old=>({...old,[source.id]:event.target.value}));setError('');setStatus('');}}><option value="">不关联本曲谱图</option>{images.map(image=><option key={image.id} value={image.id}>{image.name}</option>)}</select></label>)}</details>}
  {error&&<p className="notice warning external-score-error" role="alert">{error}</p>}
  {disabled&&!busy&&<p className="hint">当前有任务提交、运行或本地谱面修改，请先完成任务或保存、导出本地校对草稿后再导入。</p>}
  <button className="primary" disabled={disabled||busy||!text.trim()} onClick={()=>void submit()}><FileJson size={15}/>{busy?'正在校验外部转谱…':'校验并创建审核草稿'}</button>
  {status&&<p role="status" className="success-text external-score-status">{status}</p>}
 </section>;
}
