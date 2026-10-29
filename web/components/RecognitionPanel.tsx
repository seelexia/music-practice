import {useEffect,useState} from 'react';
import {ScanLine,Check,AlertCircle,RefreshCw,Download} from 'lucide-react';
import type {Job,Song} from '../types';
import {api,downloadText,recheckJob} from '../api';
import {NumberedScore} from './ScoreView';
import LyricsInput from './LyricsInput';
import ExternalScoreImport from './ExternalScoreImport';
const labels:Record<Job['status'],string>={queued:'排队中',running:'正在识谱',review:'等待人工核对',failed:'任务失败',applied:'已应用'};
const counterLabels:Record<string,string>={requests:'模型请求',modelRequests:'模型请求',actions:'工具调用',toolCalls:'工具调用',retries:'重试',pages:'页面',pagesInspected:'已检查页面',crops:'裁片',tokens:'已用额度',reservedTokens:'预留额度'};
function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function displayValue(value:unknown):string{return typeof value==='string'?value:JSON.stringify(value)??'';}
function checkLabel(value:unknown){
 const check=record(value),label=check.message??check.name??check.kind;
 const status=typeof check.status==='string'?check.status:typeof check.passed==='boolean'?(check.passed?'通过':'待核对'):'';
 return `${label===undefined?displayValue(value):displayValue(label)}${status?` · ${status}`:''}`;
}
function traceLabel(value:unknown,index:number){
 const entry=record(value),action=record(entry.action),result=record(entry.result);
 const tool=typeof entry.tool==='string'?entry.tool:typeof action.tool==='string'?action.tool:'';
 const message=entry.message??entry.error??result.message??entry.status;
 const label=message===undefined?(typeof value==='object'?`步骤 ${entry.step??entry.sequence??index+1}`:displayValue(value)):displayValue(message);
 return `${tool?`${tool} · `:''}${label}${entry.ok===false?' · 未完成':''}`;
}
export function RecognitionWorkflowSummary({song,job}:{song:Song;job:Job}){
 if(!job.workflow&&!job.trace?.length&&!job.counters&&!job.checks?.length&&job.coverage===undefined&&job.coverageComplete===undefined&&!job.partial)return null;
 return <section className="workflow-summary" aria-label="识谱工作流进度">
  <div className="section-header"><div><h3>识谱工作流记录</h3>{job.workflow&&<span className="workflow-version">{displayValue(job.workflow.id??job.workflow.name??'识谱流程')}{job.workflow.version!==undefined&&` · v${displayValue(job.workflow.version)}`}</span>}</div><button onClick={()=>downloadText(`${song.title}-识谱工作流.json`,JSON.stringify(job,null,2),'application/json')}><Download size={14}/>下载工作流记录</button></div>
  <p className="muted">{job.error||job.progress}</p>
  {job.status==='review'&&(job.partial===true||job.coverageComplete===false)&&<p className="notice warning" role="alert"><b>这是部分识谱草稿，仍有页面或片段未完成。</b>请对照原图补全后再决定是否应用。覆盖情况来自模型报告，不能证明每个音符已正确识别。</p>}
  {job.coverageComplete!==undefined&&<p className="hint">模型自报的页面覆盖（未经独立验证）：{job.coverageComplete?'完整':'未完整'}；仍需人工对照原图核对。</p>}
  {job.coverage!==undefined&&<details className="workflow-trace"><summary>查看模型报告的覆盖情况</summary><pre>{JSON.stringify(job.coverage,null,2)}</pre></details>}
  {job.counters&&<div className="workflow-counters">{Object.entries(job.counters).filter(([,value])=>typeof value==='number').map(([key,value])=><span key={key}>{counterLabels[key]||key}：{value}</span>)}</div>}
  {!!job.checks?.length&&<ul className="workflow-checks">{job.checks.map((check,index)=><li key={index}>{checkLabel(check)}</li>)}</ul>}
  {!!job.trace?.length&&<details className="workflow-trace"><summary>查看公开工具记录 · {job.trace.length} 项</summary><ol>{job.trace.map((entry,index)=><li key={index}><details><summary>{traceLabel(entry,index)}</summary><pre>{JSON.stringify(entry,null,2)}</pre></details></li>)}</ol></details>}
  <p className="hint">这里记录工具调用、检查结果和预算使用情况。检查通过或模型意见一致仍需对照原图核对。</p>
 </section>;
}
export function RecognitionDraftSummary({song,job}:{song:Song;job:Job}){
  return <>{job.mode==='lyrics'&&typeof job.lyricsText==='string'&&<details className="submitted-lyrics"><summary>本次提交的手动歌词</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{job.lyricsText}</pre><button onClick={()=>downloadText(`${song.title}-手动歌词.txt`,job.lyricsText!)}>下载本次歌词</button></details>}{job.sourcePackage!==undefined&&<details className="submitted-package"><summary>本次导入的原始转谱包</summary><pre>{JSON.stringify(job.sourcePackage,null,2)}</pre><button onClick={()=>downloadText(`${song.title}-原始转谱包.json`,JSON.stringify(job.sourcePackage,null,2),'application/json')}>下载原始转谱包</button></details>}{job.draft&&<p className="hint">当前工程 {song.score.notes.length} 音符 / 版本 {song.revision}；此草稿基于版本 {job.baseRevision}。此草稿有 {job.draft.notes.filter(n=>n.uncertain).length} 项待核对。</p>}{!!job.warnings?.length&&<div className="notice warning"><b>转谱提醒</b><ul>{job.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}{!!job.qualityIssues?.length&&<div className="notice warning"><b>待纠错的识别差异</b><ul>{job.qualityIssues.map((issue,index)=><li key={index}>{issue.message}</li>)}</ul></div>}{job.draft&&<NumberedScore score={job.draft}/>}</>;
}
export default function RecognitionPanel({song,onSongChange,onError,hasLocalEdits}:{song:Song;onSongChange:(s:Song)=>void;onError:(s:string)=>void;hasLocalEdits:boolean}){
  const [jobs,setJobs]=useState<Job[]>([]);const [busy,setBusy]=useState(false);const [selected,setSelected]=useState('');const [remove,setRemove]=useState(false);const [confirmed,setConfirmed]=useState(false);
  const [manualDraft,setManualDraft]=useState(song.lyricsText||'');const [lyricsBusy,setLyricsBusy]=useState(false);const [importBusy,setImportBusy]=useState(false);const actionBusy=busy||lyricsBusy||importBusy;
  const active=jobs.find(j=>j.id===selected);const running=jobs.some(j=>j.status==='running'||j.status==='queued');
  const progressJob=active||jobs.find(job=>job.status==='running'||job.status==='queued');
  useEffect(()=>{setRemove(false);setConfirmed(false);},[selected,song.revision]);
  function receiveJob(job:Job){setJobs(old=>[job,...old.filter(existing=>existing.id!==job.id)]);setSelected(job.id);setRemove(false);setConfirmed(false);}
  useEffect(()=>{let disposed=false;const load=()=>api<Job[]>(`/songs/${song.id}/jobs`).then(value=>{if(!disposed)setJobs(value);}).catch(e=>{if(!disposed)onError(e.message);});void load();const timer=setInterval(()=>void load(),4000);return ()=>{disposed=true;clearInterval(timer);};},[song.id]);
  async function recognize(){if(actionBusy||running||hasLocalEdits)return;setBusy(true);setRemove(false);setConfirmed(false);try{receiveJob(await api<Job>(`/songs/${song.id}/recognize`,{method:'POST',body:JSON.stringify({lyricsText:manualDraft})}));}catch(e){onError((e as Error).message);}finally{setBusy(false);}}
  async function apply(){if(!active||!confirmed||actionBusy||running||hasLocalEdits||active.baseRevision!==song.revision)return;setBusy(true);try{const updated=await api<Song>(`/songs/${song.id}/jobs/${active.id}/apply`,{method:'POST',body:JSON.stringify({revision:song.revision,removeOverlaps:remove})});onSongChange(updated);setJobs(await api<Job[]>(`/songs/${song.id}/jobs`));setSelected('');setConfirmed(false);setRemove(false);}catch(e){setConfirmed(false);onError((e as Error).message);}finally{setBusy(false);}}
  async function recheck(){if(!active||actionBusy||running||hasLocalEdits)return;setBusy(true);try{setJobs(await recheckJob(song.id,active.id));setRemove(false);setConfirmed(false);}catch(e){onError((e as Error).message);}finally{setBusy(false);}}
  return <><LyricsInput song={song} disabled={busy||importBusy||running||hasLocalEdits} onSongChange={onSongChange} onDraftChange={setManualDraft} onBusyChange={setLyricsBusy} onJob={receiveJob} onError={onError}/><ExternalScoreImport song={song} disabled={actionBusy||running||hasLocalEdits} onBusyChange={setImportBusy} onJob={receiveJob}/><section className="card recognition-card"><div className="section-header"><div><span className="eyebrow">IMAGE TO MELODY</span><h2><ScanLine size={21}/> 从谱图读出旋律</h2><p className="muted">自动识谱仍处于实验阶段，可能大量漏读、重复或误判节奏。结果先保存为草稿；请逐页对照原图核对，或使用上方外部转谱导入。</p></div><button className="primary" disabled={actionBusy||running||hasLocalEdits||!song.assets.some(a=>a.kind==='score')} onClick={recognize}><ScanLine size={16}/>{running?'识别进行中…':'开始识谱'}</button></div>
  {!song.assets.some(a=>a.kind==='score')&&<p className="notice">自动识谱需要先在“素材”上传谱图，并在“设置”选择识谱模型。外部转谱可使用上方导入入口。</p>}
  {jobs.length>0&&<div className="job-list">{jobs.map(job=><button className={`job-item ${selected===job.id?'selected':''}`} key={job.id} onClick={()=>{setSelected(selected===job.id?'':job.id);setRemove(false);setConfirmed(false);}}><span className={`job-icon ${job.status}`}>{job.status==='failed'?<AlertCircle size={18}/>:job.status==='applied'?<Check size={18}/>:<RefreshCw className={job.status==='running'?'spin':''} size={18}/>}</span><span><b>{job.mode==='lyrics'?'歌词断句 · ':job.mode==='external'?'外部转谱 · ':'谱图识别 · '}{labels[job.status]}</b><small>{job.error||job.progress}</small></span><time>{new Date(job.createdAt).toLocaleString()}</time></button>)}</div>}
  {progressJob&&<RecognitionWorkflowSummary song={song} job={progressJob}/>}
  {active&&!active.draft&&<RecognitionDraftSummary song={song} job={active}/>}
  {active?.draft&&<div className="draft-review"><div className="section-header"><h3>{active.mode==='external'?'外部转谱':'识别'}草稿 · {active.draft.notes.length} 个音符</h3><div className="actions">{active.status==='review'&&active.mode!=='lyrics'&&<button disabled={actionBusy||running||hasLocalEdits} onClick={recheck}><RefreshCw size={14}/>重新检查重叠</button>}<button onClick={()=>downloadText(`${song.title}-识谱草稿.json`,JSON.stringify(active.draft,null,2),'application/json')}>下载草稿</button></div></div><RecognitionDraftSummary song={song} job={active}/>
  {!!active.overlaps?.length&&<div className="notice warning"><b>发现可能的页面重叠</b>{active.overlaps.map((o,i)=><p key={i}>从音符 {o.start+1} 起共 {o.count} 个{o.previousCount!==undefined&&`（前页对应 ${o.previousCount} 个）`}{o.matchKind&&` · ${o.matchKind==='exact'?'精确匹配':'近似匹配'}`}：{o.reason}</p>)}<label className="check"><input type="checkbox" checked={remove} onChange={e=>setRemove(e.target.checked)}/>我已对照原图，确认移除上述重叠（真实重复乐句应保留）</label></div>}
  {active.baseRevision!==song.revision&&active.status==='review'&&<p className="notice warning">此草稿之后工程已修改，为保护人工纠错，不能直接覆盖。请下载草稿并在校对表中对照合并。</p>}
  {hasLocalEdits&&<p className="notice warning">请先保存或导出本地校对草稿，再应用识别结果。</p>}
  {active.status==='review'&&<><label className="check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已审阅草稿，应用为新的谱面版本（旧版保留在历史中）</label><button className="primary" disabled={!confirmed||actionBusy||running||hasLocalEdits||active.baseRevision!==song.revision} onClick={apply}>确认应用草稿</button></>}
  </div>}
  </section></>;
}
