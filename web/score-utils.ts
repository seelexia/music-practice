import type {Asset,Note,Score,Measure} from './types';
function keyRoot(key:string):number{
  const tonics:Record<string,number>={C:60,'C#':61,Db:61,D:62,'D#':63,Eb:63,E:64,Fb:64,'E#':65,F:65,'F#':66,Gb:66,G:55,'G#':56,Ab:56,A:57,'A#':58,Bb:58,B:59,Cb:59,'B#':60};
  const normalized=key.replace(/\s*(major|minor|m)$/,'').replace(/\s/g,'').replace(/^1=/,'').replace(/♭/g,'b').replace(/♯/g,'#');
  return Object.hasOwn(tonics,normalized)?tonics[normalized]:60;
}
export function transposeScoreKey(score:Score,key:string):Score{
 const delta=keyRoot(key)-keyRoot(score.key);
 const notes=score.notes.map(note=>{const midi=note.midi===null?null:note.midi+delta;if(midi!==null&&(midi<0||midi>127))throw new Error('更改调号将使音符超出 MIDI 音域，请先调整音区');return {...note,midi};});
 return {...score,key,notes};
}
export function numberedRhythm(duration:number):{underlines:number;dots:number;extension:string;fraction?:string}{
 for(let underlines=0;underlines<=5;underlines++){const base=2**-underlines;
  if(Math.abs(duration-base)<1e-6)return {underlines,dots:0,extension:''};
  if(Math.abs(duration-base*1.5)<1e-6)return {underlines,dots:1,extension:''};
  if(Math.abs(duration-base*1.75)<1e-6)return {underlines,dots:2,extension:''};
  if(Math.abs(duration-base*1.875)<1e-6)return {underlines,dots:3,extension:''};
 }
 if(Number.isInteger(duration)&&duration>1)return {underlines:0,dots:0,extension:duration<=5?'–'.repeat(duration-1):`–×${duration-1}`};
 let fraction=String(Number(duration.toPrecision(5)));
 for(let d=1;d<=128;d++){const n=Math.round(duration*d);if(Math.abs(n/d-duration)<1e-7){fraction=`${n}/${d}`;break;}}
 return {underlines:0,dots:0,extension:'',fraction:`${fraction} 拍`};
}
export function numberedNote(note:Note,key:string):{number:string;octave:number}{
  if(note.midi===null)return {number:note.uncertain&&note.degree!==0?'?':'0',octave:0};
  // Keep undotted do in the same default register as recognition::tonic.
  const root=keyRoot(key);
  const distance=note.midi-root;const pitch=((distance%12)+12)%12;
  return {number:['1','♯1','2','♯2','3','4','♯4','5','♯5','6','♯6','7'][pitch],octave:Math.floor(distance/12)};
}
export function scoreNoteAtBeat(notes:Note[],beat:number):Note|undefined{
  return notes.find(note=>beat>=note.beat&&beat<note.beat+note.duration);
}
export function playScorePhraseAtBeat(score:Score,beat:number,practice:{seekPhrase:(id:string)=>void}|null):void{
  const note=scoreNoteAtBeat(score.notes,beat);
  if(note)practice?.seekPhrase(note.phraseId);
}
export function scoreSource(sourcePage:string|undefined,assets:Pick<Asset,'id'|'name'|'kind'>[]):{assetId?:string;label:string}{
  if(!sourcePage)return {label:'手动录入 / 未标记来源'};
  const pages=assets.filter(asset=>asset.kind==='score');
  const index=pages.findIndex(asset=>asset.id===sourcePage||asset.name===sourcePage);
  if(index<0)return {label:'来源图片未找到'};
  return {assetId:pages[index].id,label:`第 ${index+1} 页 · ${pages[index].name}`};
}
export function parseScoreDraft(text:string):Score{
  const input=JSON.parse(text);const score=input?.score??input;
  if(!score||!Array.isArray(score.notes)||!Array.isArray(score.phrases)||score.notes.length>20000||score.phrases.length>4000)throw new Error('无效谱面：需要音符与乐句数组');
  if(!Number.isFinite(score.bpm)||score.bpm<20||score.bpm>300)throw new Error('速度应在 20–300 BPM');
  if(typeof score.key!=='string'||score.key.length>16)throw new Error('无效调性');
  if(!Array.isArray(score.timeSignature)||score.timeSignature.length!==2||!Number.isInteger(score.timeSignature[0])||score.timeSignature[0]<1||score.timeSignature[0]>32||![1,2,4,8,16].includes(score.timeSignature[1]))throw new Error('无效拍号');
  const pids=new Set<string>(),nids=new Set<string>();
  for(const p of score.phrases){if(typeof p.id!=='string'||!p.id||pids.has(p.id)||typeof p.label!=='string')throw new Error('乐句编号或名称无效');pids.add(p.id);}
  let previous=0,previousEnd=0;
  for(const n of score.notes){
    if(typeof n.id!=='string'||!n.id||nids.has(n.id))throw new Error('音符编号重复或无效');nids.add(n.id);
    if(n.midi!==null&&(!Number.isInteger(n.midi)||n.midi<0||n.midi>127))throw new Error('MIDI 音高应为 0–127 整数或 null 休止');
    if(!Number.isFinite(n.duration)||n.duration<1/128||n.duration>256||!Number.isFinite(n.beat)||n.beat<previous||n.beat>100000)throw new Error('音符时值或起拍无效');previous=n.beat;
    if(n.beat+0.000001<previousEnd)throw new Error('首版仅支持单声部主旋律，音符时段不能重叠');previousEnd=n.beat+n.duration;
    if(!pids.has(n.phraseId))throw new Error('音符缺少对应乐句');
    if(typeof n.lyric!=='string'||n.lyric.length>1000)throw new Error('歌词须为文本，单音不超过 1000 字');
  }
  return {...score,status:'draft'} as Score;
}
export function renumberNotes(notes:Note[]):Note[]{
  let beat=0;
  return notes.map(note=>{
    if(!Number.isFinite(note.duration)||note.duration<=0) throw new Error('音符时值必须大于 0');
    const result={...note,beat}; beat+=note.duration; return result;
  });
}
export function updateScoreNote(notes:Note[],index:number,change:Partial<Note>):Note[]{
  if(!notes[index])return notes;
  const duration=change.duration??notes[index].duration;
  if(!Number.isFinite(duration)||duration<=0||duration>256)throw new Error('音符时值必须大于 0 且不超过 256 拍');
  const delta=duration-notes[index].duration;
  return notes.map((note,i)=>i===index?{...note,...change}:i>index?{...note,beat:note.beat+delta}:note);
}
export function insertScoreNote(notes:Note[],index:number,note:Note):Note[]{
  if(!Number.isFinite(note.duration)||note.duration<=0||note.duration>256)throw new Error('音符时值必须大于 0 且不超过 256 拍');
  const at=Math.max(0,Math.min(notes.length,index));
  const beat=notes[at]?.beat??(notes.length?notes[notes.length-1].beat+notes[notes.length-1].duration:0);
  return [...notes.slice(0,at),{...note,beat},...notes.slice(at).map(n=>({...n,beat:n.beat+note.duration}))];
}
export function deleteScoreNote(notes:Note[],index:number):Note[]{
  if(!notes[index])return notes;
  return notes.filter((_,i)=>i!==index).map((note,i)=>i>=index?{...note,beat:note.beat-notes[index].duration}:note);
}
export function parseHumanPitch(input:string,key:string,octave=0,accidental=0):Pick<Note,'midi'|'degree'|'octave'>{
  const normalized=input.trim().toLowerCase().replace(/♯/g,'#').replace(/♭/g,'b');
  if(normalized==='?')return {midi:null,degree:null,octave:0};
  if(['0','rest','休止'].includes(normalized))return {midi:null,degree:0,octave:0};
  const match=/^([#b]?)([1-7]|do|re|mi|fa|sol|so|la|si|xi)$/.exec(normalized);
  if(!match)throw new Error('请输入 1–7 或唱名 do re mi fa sol/so la si/xi，0 为休止');
  const degree=Number(match[2])||({do:1,re:2,mi:3,fa:4,sol:5,so:5,la:6,si:7,xi:7} as Record<string,number>)[match[2]];
  const alteration=match[1]==='#'?1:match[1]==='b'?-1:accidental;
  const midi=keyRoot(key)+[0,2,4,5,7,9,11][degree-1]+12*octave+alteration;
  if(!Number.isInteger(midi)||midi<0||midi>127)throw new Error('此音高超出可用音域，请调整八度');
  return {midi,degree,octave};
}
export function notePlaybackStart(score:Score,beat:number,preRollBeats=1):number|null{
  const note=scoreNoteAtBeat(score.notes,beat);
  return note?Math.max(0,note.beat-Math.max(0,Number.isFinite(preRollBeats)?preRollBeats:1)):null;
}
export function noteLoopRange(notes:Note[],firstId:string,lastId:string):{start:number;end:number}|null{
  const first=notes.find(n=>n.id===firstId),last=notes.find(n=>n.id===lastId);
  return first&&last?{start:Math.min(first.beat,last.beat),end:Math.max(first.beat+first.duration,last.beat+last.duration)}:null;
}
export type MeasureSegment={noteId:string|null;beat:number;duration:number;continuation:boolean};
export type ScoreMeasure={index:number;start:number;duration:number;segments:MeasureSegment[];metadata?:Measure};
export function withoutScoreMeasures(score:Score):Score{
  const {measures:_,...rest}=score;
  return {...rest,notes:score.notes.map(({measureId:_,...note})=>note)};
}
export function layoutScoreMeasures(score:Score):ScoreMeasure[]{
  const duration=score.timeSignature[0]*4/score.timeSignature[1];
  const end=Math.max(0,...score.notes.map(n=>n.beat+n.duration));
  if(!Number.isFinite(duration)||duration<=0||!end)return [];
  const printed=score.measures??[],byId=new Map(printed.map(m=>[m.id,m]));
  let previousEnd=0,previousNoteEnd=0;
  const validPrinted=printed.length>0&&byId.size===printed.length&&printed.every(m=>{
    const valid=Number.isFinite(m.startBeat)&&Number.isFinite(m.duration)&&m.duration>0&&Math.abs(m.startBeat-previousEnd)<1e-6;previousEnd=m.startBeat+m.duration;return valid;
  })&&previousEnd>=end-1e-6&&score.notes.every(note=>{
    const measure=note.measureId?byId.get(note.measureId):printed.find(m=>note.beat>=m.startBeat-1e-6&&note.beat<m.startBeat+m.duration-1e-6);
    const valid=note.beat>=previousNoteEnd-1e-6&&!!measure&&note.beat>=measure.startBeat-1e-6&&note.beat<measure.startBeat+measure.duration-1e-6;previousNoteEnd=note.beat+note.duration;return valid;
  });
  const measures:ScoreMeasure[]=validPrinted?printed.map((metadata,index)=>({index,start:metadata.startBeat,duration:metadata.duration,segments:[],metadata})):Array.from({length:Math.ceil((end-1e-8)/duration)},(_,index)=>({index,start:index*duration,duration,segments:[]}));
  function add(noteId:string|null,start:number,length:number){
    let beat=start,remaining=length,index=measures.findIndex(m=>beat>=m.start-1e-7&&beat<m.start+m.duration-1e-7);
    while(remaining>1e-7){
      const measure=measures[index];if(!measure)break;
      const part=Math.min(remaining,measure.start+measure.duration-beat);
      measure.segments.push({noteId,beat,duration:part,continuation:noteId!==null&&beat>start+1e-7});
      beat+=part;remaining-=part;index++;
    }
  }
  let cursor=0;
  for(const note of score.notes){if(note.beat>cursor+1e-7)add(null,cursor,note.beat-cursor);add(note.id,note.beat,note.duration);cursor=note.beat+note.duration;}
  return measures;
}
export function moveNote(notes:Note[],index:number,direction:number):Note[]{
  const target=index+direction;
  if(index<0||index>=notes.length||target<0||target>=notes.length)return notes;
  const result=[...notes]; const [note]=result.splice(index,1); result.splice(target,0,note);
  return renumberNotes(result);
}
export function selectedMetadata(preview:Record<string,unknown>,fields:string[]):Record<string,string>{
  const allowed=['title','artist','album','description'];
  return Object.fromEntries(fields.filter(f=>allowed.includes(f)&&typeof preview[f]==='string').map(f=>[f,preview[f] as string]));
}
