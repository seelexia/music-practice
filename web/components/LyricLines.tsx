import {lyricRows} from '../lyrics';
export default function LyricLines({text,rows=1}:{text:string;rows?:number}){
 const lines=lyricRows(text);
 return <>{Array.from({length:Math.max(rows,lines.length)},(_,row)=><span className="lyric-line" data-lyric-row={row+1} key={row}>{lines[row]||'\u00a0'}</span>)}</>;
}
