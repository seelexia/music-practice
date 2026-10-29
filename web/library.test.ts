import assert from 'node:assert/strict';
import test from 'node:test';
import type {Song} from './types';
import {filterLibrarySongs,libraryTags} from './library';
import * as library from './library';

function song(id:string,patch:Partial<Song>&{deletedAt?:string}={}):Song{
 return {id,revision:1,title:'未命名',artist:'',album:'',composer:'',lyricist:'',description:'',tags:[],links:{bilibili:'',qq:'',netease:''},coverId:null,assets:[],score:{bpm:120,key:'C',timeSignature:[4,4],notes:[],phrases:[],status:'review'},alignment:{offset:0,anchors:[]},archived:false,createdAt:'',updatedAt:'',...patch};
}
const fixtures=[
 song('spring',{title:'春日练习',artist:'林声',album:'晨光',composer:'风',description:'轻声慢唱',tags:['练习','抒情',' Vocal ']}),
 song('moon',{title:'月光',artist:'林声',tags:['练习','Vocal训练']}),
 song('old',{title:'旧歌',archived:true,tags:['归档','练习']}),
 song('trash',{title:'已删除',archived:true,tags:['归档'],deletedAt:'2026-10-28'}),
];

test('library overview defaults to all active songs and separates archive/deleted songs',()=>{
 assert.deepEqual(filterLibrarySongs(fixtures,{archived:false}).map(s=>s.id),['spring','moon']);
 assert.deepEqual(filterLibrarySongs(fixtures,{archived:true}).map(s=>s.id),['old']);
});
test('keyword tokens combine with AND across editable song metadata and tags',()=>{
 assert.deepEqual(filterLibrarySongs(fixtures,{archived:false,query:' 林声  晨光 轻声 '}).map(s=>s.id),['spring']);
 assert.deepEqual(filterLibrarySongs(fixtures,{archived:false,query:'风 vocal'}).map(s=>s.id),['spring']);
 assert.deepEqual(filterLibrarySongs(fixtures,{archived:false,query:'林声 不存在'}),[]);
});
test('tag filters use exact normalized tag names and multiple selected tags require all',()=>{
 assert.deepEqual(filterLibrarySongs(fixtures,{archived:false,tags:['vocal']}).map(s=>s.id),['spring']);
 assert.deepEqual(filterLibrarySongs(fixtures,{archived:false,tags:['练习',' 抒情 ']}).map(s=>s.id),['spring']);
 assert.deepEqual(filterLibrarySongs(fixtures,{archived:false,tags:['Vocal训练','抒情']}),[]);
 assert.deepEqual(filterLibrarySongs(fixtures,{archived:false,query:'月光',tags:['抒情']}),[]);
 assert.equal(filterLibrarySongs(fixtures,{archived:false,query:'',tags:[]}).length,2);
});
test('available tag counts are scoped to the current library section and deduplicate per song',()=>{
 const repeated=song('repeat',{tags:['练习','练习',' vocal ','VOCAL','']});
 const tags=libraryTags([...fixtures,repeated],false);
 assert.equal(tags.find(t=>t.name==='练习')?.count,3);
 assert.equal(tags.find(t=>t.name==='Vocal')?.count,2);
 assert.equal(tags.some(t=>t.name==='归档'),false);
 assert.deepEqual(libraryTags(fixtures,true),[{name:'归档',count:1},{name:'练习',count:1}]);
});

test('wishlist classification is explicit; ordinary empty songs stay in library and archive includes both kinds',()=>{
 const rows=[song('empty'),song('wish',{tags:[' 愿望单 ','摇滚']}),song('archived-wish',{archived:true,tags:['愿望单']}),song('archived-song',{archived:true})];
 assert.deepEqual(filterLibrarySongs(rows,{archived:false}).map(s=>s.id),['empty']);
 assert.deepEqual(filterLibrarySongs(rows,{archived:false,wishlist:true} as Parameters<typeof filterLibrarySongs>[1]).map(s=>s.id),['wish']);
 assert.deepEqual(filterLibrarySongs(rows,{archived:true}).map(s=>s.id),['archived-wish','archived-song']);
 assert.deepEqual(filterLibrarySongs([{...rows[2],archived:false}],{archived:false,wishlist:true} as Parameters<typeof filterLibrarySongs>[1]).map(s=>s.id),['archived-wish']);
});

test('wishlist search and user tag counts are independent and never expose the reserved classification tag',()=>{
 const rows=[song('normal',{title:'普通',tags:['钢琴']}),song('wish',{title:'想唱',artist:'歌手甲',tags:['愿望单','摇滚','摇滚']}),song('other',{tags:['愿望单','抒情']})];
 assert.deepEqual(filterLibrarySongs(rows,{archived:false,wishlist:true,query:'想唱 歌手甲',tags:['摇滚']} as Parameters<typeof filterLibrarySongs>[1]).map(s=>s.id),['wish']);
 assert.deepEqual((libraryTags as (s:Song[],a:boolean,w?:boolean)=>{name:string;count:number}[])(rows,false,true),[{name:'抒情',count:1},{name:'摇滚',count:1}]);
 assert.deepEqual(libraryTags(rows,false),[{name:'钢琴',count:1}]);
});

test('metadata tag edits preserve wishlist classification and completion removes only that tag',()=>{
 const helpers=library as typeof library&{metadataTags:(song:Song,tags:string[])=>string[];wishlistCompletion:(song:Song)=>Partial<Song>};
 assert.equal(typeof helpers.metadataTags,'function');
 assert.equal(typeof helpers.wishlistCompletion,'function');
 const wish=song('wish',{title:'保留歌名',tags:['愿望单',' 手填标签 '],lyricsText:'原歌词',links:{bilibili:'https://example.test/b',qq:'',netease:''},assets:[{id:'original-score',kind:'score',name:'原谱图.png',mime:'image/png',size:123,url:'/api/assets/original-score',createdAt:''}],score:{bpm:93,key:'F',timeSignature:[3,4],notes:[{id:'kept-note',beat:0,duration:1,midi:65,lyric:'原',phraseId:'p'}],phrases:[{id:'p',label:'原句'}],status:'corrected'}});
 assert.deepEqual(helpers.metadataTags(wish,['新标签']),['新标签','愿望单']);
 assert.deepEqual(helpers.metadataTags(song('normal'),['愿望单','普通标签']),['普通标签']);
 const changes=helpers.wishlistCompletion(wish);
 assert.deepEqual(changes,{tags:[' 手填标签 ']});
 const completed={...wish,...changes};
 assert.equal(completed.id,'wish');assert.equal(completed.title,'保留歌名');assert.equal(completed.lyricsText,'原歌词');assert.equal(completed.links,wish.links);assert.equal(completed.score,wish.score);assert.equal(completed.assets,wish.assets);
});
