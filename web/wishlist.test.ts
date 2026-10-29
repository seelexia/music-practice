import assert from 'node:assert/strict';
import test from 'node:test';
import type {Song} from './types';
import * as library from './library';

const fixture:Song={id:'same-wish',revision:1,title:'想唱的歌',artist:'',album:'专辑',composer:'作曲',lyricist:'作词',description:'先留资料',lyricsText:'原词',tags:['个人标签'],links:{bilibili:'https://example.test/song',qq:'',netease:''},coverId:null,assets:[],score:{bpm:93,key:'F',timeSignature:[3,4],notes:[],phrases:[],status:'review'},alignment:{offset:1,anchors:[]},archived:false,createdAt:'',updatedAt:''};
type Transport={create:(input:{title:string;artist:string})=>Promise<Song>;read:(id:string)=>Promise<Song>;patch:(song:Song,changes:Partial<Song>)=>Promise<Song>};
const getSave=()=>{
 const save=(library as typeof library&{saveWishlist:(input:{title:string;artist:string},pendingId:string,remember:(id:string)=>void,transport:Transport)=>Promise<Song>}).saveWishlist;
 assert.equal(typeof save,'function','wishlist creation must retain an already-created ID before attempting classification');return save;
};

test('classification failure retains the created ID and retry reuses that exact record with fresh revision and metadata',async()=>{
 const save=getSave();let created=0,pending='',fail=true,stored=structuredClone(fixture);
 const transport:Transport={create:async input=>{created++;assert.deepEqual(input,{title:'想唱的歌',artist:''});return structuredClone(stored);},read:async id=>{assert.equal(id,'same-wish');return structuredClone(stored);},patch:async(song,changes)=>{assert.equal(pending,'same-wish');if(fail)throw new Error('classification failed');assert.equal(song.revision,4);assert.deepEqual(changes,{tags:['个人标签','后续标签','愿望单']});stored={...song,...changes,revision:5};return stored;}};
 await assert.rejects(save({title:'想唱的歌',artist:''},pending,id=>{pending=id;},transport),/classification failed/);
 assert.equal(created,1);assert.equal(pending,'same-wish');
 fail=false;stored={...stored,revision:4,album:'后来补充的专辑',tags:['个人标签','后续标签']};
 const result=await save({title:'不能新建另一首',artist:'不能覆盖'},pending,id=>{pending=id;},transport);
 assert.equal(created,1);assert.equal(result.id,'same-wish');assert.equal(result.album,'后来补充的专辑');assert.deepEqual(result.tags,['个人标签','后续标签','愿望单']);assert.deepEqual(result.score,fixture.score);assert.deepEqual(result.links,fixture.links);assert.equal(result.lyricsText,'原词');
});

test('retry after a lost classification response returns the existing wishlist without rewriting it',async()=>{
 const save=getSave();const existing={...fixture,revision:3,tags:['愿望单','原标签']};
 const result=await save({title:'',artist:''},'same-wish',()=>{}, {create:async()=>{throw new Error('must not create again');},read:async()=>existing,patch:async()=>{throw new Error('must not rewrite an already classified record');}});
 assert.equal(result,existing);assert.equal(result.revision,3);
});
