import type {Song} from './types';
import {tagKey} from './library';
const bytes=(value:string)=>new TextEncoder().encode(value).length;
export function parseBatchTags(text:string):string[]{
 const tags:string[]=[],seen=new Set<string>();
 for(const raw of text.split(/[,，;；\n]+/u)){const tag=raw.normalize('NFC').trim(),key=tagKey(tag);if(!key||seen.has(key))continue;
  if(bytes(tag)>100||/[\u0000-\u001f]/u.test(tag))throw Error('每个标签最多100个UTF-8字节，且不能含控制字符');seen.add(key);tags.push(tag);
 }
 if(!tags.length)throw Error('请填写要添加或移除的标签，用逗号分隔');
 if(tags.length>100)throw Error('一次最多填写100个标签');return tags;
}
export function batchTags(existing:readonly string[],requested:readonly string[],mode:'add'|'remove'):string[]{
 const keys=new Set(requested.map(tagKey));
 if(mode==='remove')return existing.filter(tag=>!keys.has(tagKey(tag)));
 const result=[...existing],seen=new Set(existing.map(tagKey));
 for(const tag of requested){const key=tagKey(tag);if(key&&!seen.has(key)){seen.add(key);result.push(tag.trim());}}
 if(result.length>100)throw Error('添加后标签超过100项，请先移除部分标签');return result;
}
export type BatchFailure={song:Song;message:string};
export async function runLibraryBatch(targets:readonly Song[],mutate:(song:Song)=>Promise<Song>,progress?:(done:number)=>void):Promise<{succeeded:Song[];failed:BatchFailure[]}>{
 const succeeded:Song[]=[],failed:BatchFailure[]=[];let done=0;
 for(const song of targets){try{succeeded.push(await mutate(song));}catch(error){failed.push({song,message:error instanceof Error?error.message:String(error)});}done++;progress?.(done);}
 return {succeeded,failed};
}
