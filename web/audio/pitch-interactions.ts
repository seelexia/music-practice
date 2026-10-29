import {parseHumanPitch} from '../score-utils';

/** Display coordinates only. Negative live starts leave room before a new capture. */
export function pitchTimeline(cursor:number,span:number,live:boolean,ratio=.5):{start:number;end:number;cursorRatio:number}{
 const duration=Number.isFinite(span)&&span>0?span:12,time=Number.isFinite(cursor)?cursor:0;
 const anchor=Math.max(.1,Math.min(.9,Number.isFinite(ratio)?ratio:.5));
 const start=live?time-duration*anchor:Math.max(0,time-duration*.35);
 return {start,end:start+duration,cursorRatio:live?anchor:(time-start)/duration};
}
export function pitchCursorRatio(pointerX:number,width:number):number{
 return width>48&&Number.isFinite(pointerX)&&Number.isFinite(width)?Math.max(.1,Math.min(.9,(pointerX-48)/(width-48))):.5;
}
export function pitchPlotSize(width:number,height:number,availableWidth:number,viewportHeight:number):{width:number;height:number}{
 const maximumWidth=Math.max(1,Number.isFinite(availableWidth)?availableWidth:260),minimumWidth=Math.min(260,maximumWidth);
 return {width:Math.max(minimumWidth,Math.min(maximumWidth,Number.isFinite(width)?width:maximumWidth)),height:Math.max(220,Math.min(Math.max(720,viewportHeight*2),Number.isFinite(height)?height:220))};
}

type ReferenceNote={beat:number;duration:number;midi:number|null};
type ReferenceActivity={showReference?:boolean;live?:boolean;referenceActive?:boolean};

/** A reference only sounds inside its own half-open event, while transport is active. */
export function activeReferenceMidi(notes:ReferenceNote[],beat:number,shift:number,{showReference=true,live=false,referenceActive=true}:ReferenceActivity={}):number|null{
  if(!showReference||live||!referenceActive||!Number.isFinite(beat)||!Number.isFinite(shift))return null;
  const note=notes.find(note=>beat>=note.beat&&beat<note.beat+note.duration);
  if(note?.midi===null||note?.midi===undefined)return null;
  const midi=note.midi+shift;
  return Number.isInteger(midi)&&midi>=0&&midi<=127?midi:null;
}

/** The active pitch bypasses guide filtering and density, without changing either. */
export function pitchAxisNotes(range:[number,number],includeSemitones=true,labelStep=1,activeMidi:number|null=null):number[]{
  const notes=pitchGridNotes(range,includeSemitones).filter(m=>m%labelStep===0||m%12===0);
  if(activeMidi!==null&&Number.isInteger(activeMidi)&&activeMidi>=Math.max(0,range[0])&&activeMidi<=Math.min(127,range[1])&&!notes.includes(activeMidi))notes.push(activeMidi);
  return notes.sort((a,b)=>a-b);
}

/** MIDI is the displayed/sounding pitch; transpose moves both it and the tonic. */
export function pitchSolfege(midi:number,key='C',shift=0,degree?:number|null):string{
  if(!Number.isFinite(midi)||!Number.isFinite(shift))return '';
  const tonic=parseHumanPitch('do',key).midi!,pitch=((Math.round(midi)-shift-tonic)%12+12)%12;
  const names=['do','re','mi','fa','sol','la','si'],steps=[0,2,4,5,7,9,11];
  if(degree!==null&&degree!==undefined&&Number.isInteger(degree)&&degree>=1&&degree<=7){
    const alteration=((pitch-steps[degree-1]+18)%12)-6;
    // Inconsistent legacy degrees must never override the actual semitone.
    if(Number.isInteger(alteration)&&Math.abs(alteration)<=2)return (alteration<0?'♭'.repeat(-alteration):'♯'.repeat(alteration))+names[degree-1];
  }
  return ['do','♯do','re','♯re','mi','fa','♯fa','sol','♯sol','la','♯la','si'][pitch]??'';
}

/** Guide lines only: measured and reference pitch keep their original values. */
export function pitchGridNotes(range:[number,number],includeSemitones=true):number[]{
  const notes:number[]=[];
  for(let midi=Math.max(0,Math.ceil(range[0]));midi<=Math.min(127,range[1]);midi++){
    if(includeSemitones||[0,2,4,5,7,9,11].includes(midi%12))notes.push(midi);
  }
  return notes;
}

/** Move the visible window without changing its span, including after wheel zoom. */
export function panPitchRange(range:[number,number],delta:number):[number,number]{
  const [low,high]=range,span=high-low;
  if(![low,high,delta].every(Number.isFinite)||low<0||high>127||span<=0)return [low,high];
  const nextLow=Math.max(0,Math.min(127-span,low+delta));
  return [nextLow,nextLow+span];
}

/** Coordinates match the padded plot used by PitchCanvas. */
export function pointerPitch(range:[number,number],pointerY:number,height:number,top=16,bottom=16):number {
  const fraction=Number.isFinite(pointerY)&&Number.isFinite(height)&&height>top+bottom
    ?Math.max(0,Math.min(1,(height-bottom-pointerY)/(height-top-bottom))):.5;
  return range[0]+fraction*(range[1]-range[0]);
}

/** Keep the pitch beneath the cursor fixed unless a MIDI boundary is reached. */
export function zoomPitchRange(range:[number,number],pointerY:number,height:number,deltaY:number,top=16,bottom=16):[number,number] {
  const [low,high]=range;
  if(![low,high,pointerY,height,deltaY,top,bottom].every(Number.isFinite)||height<=top+bottom||deltaY===0||low<0||high>127||high<=low)return [low,high];
  const oldSpan=high-low,anchor=pointerPitch(range,pointerY,height,top,bottom),fraction=(anchor-low)/oldSpan;
  const factor=Math.exp(Math.max(-240,Math.min(240,deltaY))/600);
  const span=Math.max(6,Math.min(127,oldSpan*factor));
  const nextLow=Math.max(0,Math.min(127-span,anchor-fraction*span));
  return [nextLow,nextLow+span];
}

export type PitchPoint={beat:number;midi:number|null;raw:number|null;at:number;continuityId?:number};
export type ApproximatePitchNote={midi:number;start:number;end:number;startAt:number;endAt:number};

/** Approximate voiced runs only; retain their actual captured ends, not guesses. */
export function approximatePitchNotes(points:PitchPoint[],live:boolean):ApproximatePitchNote[] {
  const result:ApproximatePitchNote[]=[];
  let current:ApproximatePitchNote|null=null,frames=0,previous:PitchPoint|null=null;
  const finish=()=>{
    if(current&&frames>=3&&current.endAt-current.startAt>=.08-1e-9)result.push(current);
    current=null;frames=0;
  };
  for(const point of points){
    const position=live?point.at:point.beat;
    if(point.midi===null||!Number.isFinite(point.midi)||point.midi<0||point.midi>127||!Number.isFinite(point.at)||!Number.isFinite(position)){
      finish();previous=null;continue;
    }
    const midi=Math.round(point.midi);
    let continuous=true;
    if(previous){
      const elapsed=point.at-previous.at,delta=position-(live?previous.at:previous.beat);
      continuous=point.continuityId===previous.continuityId&&elapsed>0&&elapsed<=.25&&delta>=0&&(live||delta<=Math.max(1,elapsed*24));
    }
    if(!current||current.midi!==midi||!continuous){
      finish();current={midi,start:position,end:position,startAt:point.at,endAt:point.at};frames=1;
    }else{
      current.end=position;current.endAt=point.at;frames++;
    }
    previous=point;
  }
  finish();return result;
}
