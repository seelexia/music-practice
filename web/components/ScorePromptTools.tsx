import {useEffect,useRef,useState} from 'react';
import {Copy,Download,FileJson} from 'lucide-react';
import {api,downloadText} from '../api';
import {externalTranscriptionPrompt,externalTranscriptionExample} from '../external-prompt';
import type {ExternalScorePrompt,ScoreFormat,Song} from '../types';
export type ScorePromptToolsProps={song?:Song;disabled?:boolean;onOpenImport?:()=>void};
export default function ScorePromptTools({song,disabled=false,onOpenImport}:ScorePromptToolsProps){
 const [format,setFormat]=useState<ScoreFormat|null>(null),[context,setContext]=useState<ExternalScorePrompt|null>(null);
 const [formatError,setFormatError]=useState(''),[contextError,setContextError]=useState(''),[retry,setRetry]=useState(0);
 const [copying,setCopying]=useState(false),[fallback,setFallback]=useState(false),[status,setStatus]=useState('');
 const textarea=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{
  let disposed=false;setFormatError('');
  void api<ScoreFormat>('/score-format').then(value=>{if(!disposed)setFormat(value);}).catch(cause=>{if(!disposed)setFormatError((cause as Error).message);});
  return()=>{disposed=true;};
 },[retry]);
 useEffect(()=>{
  let disposed=false;setContext(null);setContextError('');setFallback(false);setStatus('');
  if(song)void api<ExternalScorePrompt>(`/songs/${song.id}/external-prompt`).then(value=>{if(!disposed)setContext(value);}).catch(cause=>{if(!disposed)setContextError((cause as Error).message);});
  return()=>{disposed=true;};
 },[song?.id,song?.revision,retry]);
 const basePrompt=song?context?.prompt:format?.prompt;
 const prompt=basePrompt?externalTranscriptionPrompt(basePrompt):'';
 useEffect(()=>{if(fallback&&prompt){textarea.current?.focus();textarea.current?.select();}},[fallback,prompt]);
 async function copy(){
  if(disabled||copying||!prompt)return;setCopying(true);setStatus('');
  try{await navigator.clipboard.writeText(prompt);setFallback(false);setStatus('已复制。请将原图和提示词一起提供给外部工具。');}
  catch{setFallback(true);setStatus('浏览器未允许自动复制，提示词已选中，请按 Ctrl+C 或 ⌘C。');}
  finally{setCopying(false);}
 }
 return <section className="score-prompt-tools" aria-label="外部转谱工具">
  <h3>交给外部工具识谱</h3>
  <p>请让 Codex / Claude 交付 <b>score.shengjian.score.json</b>（UTF-8 JSON），不要仅交付 HTML。支持两遍歌词、翻译或空耳的双行显示。自行提供原图，导入后先审阅。</p>
  <div className="actions">
   <button disabled={disabled||copying||!prompt} onClick={()=>void copy()}><Copy size={14}/>{copying?'正在复制…':'复制外部转谱提示词'}</button>
   {onOpenImport&&<button disabled={disabled} onClick={onOpenImport}><FileJson size={14}/>导入外部转谱 JSON</button>}
   <button disabled={disabled||!format} onClick={()=>downloadText('shengjian-score.schema.json',JSON.stringify(format!.schema,null,2),'application/json')}><Download size={14}/>下载格式规范</button>
   <button disabled={disabled||!format} onClick={()=>downloadText('shengjian-score.template.json',JSON.stringify(externalTranscriptionExample(format!.template),null,2),'application/json')}><Download size={14}/>下载示例模板</button>
  </div>
  {(formatError||contextError)&&<div className="notice warning" role="alert">{contextError||formatError}<button disabled={disabled} onClick={()=>setRetry(value=>value+1)}>重新读取提示词资料</button></div>}
  {fallback&&<label className="score-prompt-fallback">手动复制提示词<textarea ref={textarea} aria-label="手动复制外部转谱提示词" readOnly rows={5} value={prompt} onFocus={event=>event.currentTarget.select()}/></label>}
  {status&&<p className="score-prompt-status" role="status">{status}</p>}
 </section>;
}
