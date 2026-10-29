import type {Note} from './types';
import {scoreNoteAtBeat} from './score-utils';
import {lyricRows} from './lyrics';
/** The existing exporter emits a sound-only direction. OSMD rejects its whole
 * measure unless a direction-type is present. Adapt that exact legacy form for
 * display; never rewrite musical events or already annotated directions. */
export function staffCompatibleMusicXml(xml:string):string {
  return xml.replace(/<direction>\s*<sound tempo="(\d+(?:\.\d+)?)"\s*\/>\s*<\/direction>/g,(_,tempo:string)=>
    `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>`)
    // Only adapt the exporter's unnumbered text form. Keep entities escaped.
    .replace(/<lyric><text>([\s\S]*?)<\/text><\/lyric>/g,(original,text:string)=>{
      const rows=lyricRows(text);return rows.length===1?original:rows.map((row,index)=>`<lyric number="${index+1}"><text>${row}</text></lyric>`).join('');
    });
}
export type StaffFragment<T>={beat:number;duration:number;graphic:T};
export type StaffBinding<T>=StaffFragment<T>&{noteId:string};
export function bindStaffFragments<T>(notes:Note[],fragments:StaffFragment<T>[]):StaffBinding<T>[] {
  return fragments.flatMap(fragment=>{
    const note=scoreNoteAtBeat(notes,fragment.beat);
    return note?[{...fragment,noteId:note.id}]:[];
  });
}
export function staffPlaybackAtBeat<T>(notes:Note[],bindings:StaffBinding<T>[],beat:number):{active:StaffBinding<T>[];current?:StaffBinding<T>}{
  const note=scoreNoteAtBeat(notes,beat);
  const active=note?bindings.filter(binding=>binding.noteId===note.id):[];
  return {active,current:active.find(fragment=>beat>=fragment.beat&&beat<fragment.beat+fragment.duration)??active[0]};
}
