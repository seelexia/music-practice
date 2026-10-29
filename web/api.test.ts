import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recheckJob} from './api.ts';

test('overlap recheck posts to the selected saved job and then refreshes the displayed jobs',async()=>{
  const previous=globalThis.fetch;
  const calls:{path:string;method:string;client:string|null}[]=[];
  const updated={id:'job-1',songId:'song-1',status:'review',progress:'已重查',baseRevision:2,createdAt:'2026-10-27',overlaps:[{start:10,count:6,reason:'边界近似匹配'}]};
  globalThis.fetch=async(input,options)=>{
    calls.push({path:String(input),method:options?.method??'GET',client:new Headers(options?.headers).get('X-Music-Client')});
    return Response.json(calls.length===1?updated:[updated]);
  };
  try{
    assert.deepEqual(await recheckJob('song-1','job-1'),[updated]);
    assert.deepEqual(calls,[{path:'/api/songs/song-1/jobs/job-1/recheck',method:'POST',client:'web'},{path:'/api/songs/song-1/jobs',method:'GET',client:'web'}]);
  }finally{globalThis.fetch=previous;}
});
