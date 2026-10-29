import type {Score} from './types';

/** LF separates aligned lyric rows. Preserve blank upper rows and word spacing. */
export function lyricRows(text:string):string[]{return text.replace(/\r\n?/g,'\n').split('\n');}
export function joinLyricRows(rows:readonly string[]):string{
 const result=[...rows];while(result.length>1&&result.at(-1)==='')result.pop();
 const text=result.join('\n');
 if(new TextEncoder().encode(text).length>1000)throw new Error('同一音符的全部歌词合计不能超过1000个UTF-8字节');
 return text;
}
export function lyricRowCount(texts:readonly string[]):number{return texts.reduce((count,text)=>Math.max(count,lyricRows(text).length),1);}
export function scoreLyricsText(score:Score):string{
 const multiple=score.notes.some(note=>lyricRows(note.lyric).length>1);
 return score.phrases.map(phrase=>{
  const notes=score.notes.filter(note=>note.phraseId===phrase.id),count=lyricRowCount(notes.map(note=>note.lyric));
  return Array.from({length:count},(_,row)=>notes.map(note=>lyricRows(note.lyric)[row]??'').join('')).join('\n');
 }).join(multiple?'\n\n':'\n');
}
