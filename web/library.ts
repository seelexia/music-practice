import type {Song} from './types';

export type LibraryFilter={archived:boolean;wishlist?:boolean;query?:string;tags?:readonly string[]};
export const tagKey=(value:string)=>value.normalize('NFC').trim().toLocaleLowerCase();
export const WISHLIST_TAG='愿望单';
export const isWishlistSong=(song:Pick<Song,'tags'>)=>song.tags.some(tag=>tagKey(tag)===tagKey(WISHLIST_TAG));
export const userSongTags=(tags:readonly string[])=>tags.filter(tag=>tagKey(tag)!==tagKey(WISHLIST_TAG));
// Classification changes only through the wishlist actions, never the user tag editor.
export const metadataTags=(song:Pick<Song,'tags'>,tags:readonly string[])=>[...userSongTags(tags),...(isWishlistSong(song)?[WISHLIST_TAG]:[])];
export const wishlistCompletion=(song:Pick<Song,'tags'>):Pick<Song,'tags'>=>({tags:userSongTags(song.tags)});

type WishlistTransport={create:(input:{title:string;artist:string})=>Promise<Song>;read:(id:string)=>Promise<Song>;patch:(song:Song,changes:Partial<Song>)=>Promise<Song>};
export async function saveWishlist(input:{title:string;artist:string},pendingId:string,remember:(id:string)=>void,transport:WishlistTransport):Promise<Song>{
 const song=pendingId?await transport.read(pendingId):await transport.create(input);
 // Remember before the second request: retry must not create another song even if its response was lost.
 remember(song.id);
 if(song.deletedAt)throw new Error('这首待完成的歌曲已在回收站，请先到归档歌曲中恢复。');
 if(isWishlistSong(song))return song;
 return transport.patch(song,{tags:[...song.tags,WISHLIST_TAG]});
}

export function filterLibrarySongs(songs:readonly Song[],{archived,wishlist=false,query='',tags=[]}:LibraryFilter):Song[]{
 const tokens=tagKey(query).split(/\s+/u).filter(Boolean),required=tags.map(tagKey).filter(Boolean);
 return songs.filter(song=>{
  if(song.deletedAt||song.archived!==archived)return false;
  if(!archived&&isWishlistSong(song)!==wishlist)return false;
  const haystack=tagKey([song.title,song.artist,song.album,song.composer,song.lyricist,song.description,...userSongTags(song.tags)].join(' '));
  const ownTags=new Set(song.tags.map(tagKey));
  return tokens.every(token=>haystack.includes(token))&&required.every(tag=>ownTags.has(tag));
 });
}

export function libraryTags(songs:readonly Song[],archived:boolean,wishlist=false):{name:string;count:number}[]{
 const tags=new Map<string,{name:string;count:number}>();
 for(const song of filterLibrarySongs(songs,{archived,wishlist})){
  const seen=new Set<string>();
  for(const value of userSongTags(song.tags)){
   const key=tagKey(value);if(!key||seen.has(key))continue;seen.add(key);
   const old=tags.get(key);tags.set(key,{name:old?.name??value.trim(),count:(old?.count??0)+1});
  }
 }
 return Array.from(tags.values()).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
