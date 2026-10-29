import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RecognitionDraftSummary,RecognitionWorkflowSummary} from './components/RecognitionPanel.tsx';
import type {Job,Song} from './types.ts';

test('recognition review shows the selected draft uncertainty and persisted job warnings',()=>{
  const score={bpm:80,key:'C',timeSignature:[4,4] as [number,number],status:'review',phrases:[{id:'p',label:'一句'}],notes:[{id:'n',beat:0,duration:1,midi:60,lyric:'歌',phraseId:'p',uncertain:true}]};
  const song={id:'s',revision:9,score:{...score,notes:score.notes.map(n=>({...n,uncertain:false}))}} as Song;
  const job={id:'j',songId:'s',status:'review',progress:'待核对',baseRevision:7,createdAt:'2026-10-27',draft:score,warnings:['本页未能读出调号，请人工核对','第二张谱图节奏存疑']} as Job;
  const markup=renderToStaticMarkup(createElement(RecognitionDraftSummary,{song,job}));
  assert.match(markup,/此草稿有 1 项待核对/);
  assert.match(markup,/版本 9/);
  assert.match(markup,/基于版本 7/);
  assert.match(markup,/本页未能读出调号，请人工核对/);
  assert.match(markup,/第二张谱图节奏存疑/);
});

test('failed lyric jobs expose the submitted authoritative text without a draft',()=>{
  const song={id:'s',revision:5,score:{notes:[]}} as unknown as Song;
  const job={id:'j',songId:'s',mode:'lyrics',status:'failed',progress:'failed',baseRevision:5,lyricsText:'你\n好',createdAt:'2026-10-27'} as Job;
  const markup=renderToStaticMarkup(createElement(RecognitionDraftSummary,{song,job}));
  assert.match(markup,/本次提交的手动歌词/);assert.match(markup,/你\n好/);assert.match(markup,/下载本次歌词/);
});

test('workflow review retains nested tool evidence and flexible check values without crashing',()=>{
  const song={id:'s',title:'Synthetic'} as Song;
  const job={id:'j',songId:'s',status:'failed',progress:'Partial evidence retained',baseRevision:2,createdAt:'2026-10-28',
    workflow:{name:'Bounded tool workflow',version:1},counters:{requests:2,crops:1,reservedTokens:8000},
    checks:[{kind:'coverage',message:{missing:['page-2']},passed:false},'Manual review required',null],
    trace:[{sequence:1,action:{tool:'inspect_crop',sourceId:'page-1',bounds:[0,0,100,80]},ok:false,error:'Budget exhausted'},'Partial output retained',null]
  } as unknown as Job;
  const markup=renderToStaticMarkup(createElement(RecognitionWorkflowSummary,{song,job}));
  assert.match(markup,/Bounded tool workflow/);
  assert.match(markup,/inspect_crop/);
  assert.match(markup,/Budget exhausted/);
  assert.match(markup,/page-2/);
  assert.match(markup,/Manual review required/);
  assert.match(markup,/Partial output retained/);
  assert.match(markup,/8000/);
});

test('external review retains submitted package and quality errors even without a draft',()=>{
  const song={id:'s',revision:4,score:{notes:[]}} as unknown as Song;
  const job={id:'j',songId:'s',mode:'external',status:'failed',progress:'failed',baseRevision:4,createdAt:'2026-10-28',sourcePackage:{format:'shengjian.score',version:1,metadata:{title:'Synthetic'}},qualityIssues:[{kind:'duration',message:'measures[0].notes[0].duration does not match rhythm'}]} as Job;
  const markup=renderToStaticMarkup(createElement(RecognitionDraftSummary,{song,job}));
  assert.match(markup,/原始转谱包/);
  assert.match(markup,/shengjian.score/);
  assert.match(markup,/measures\[0\].notes\[0\].duration/);
});

test('a partial recognition review makes incomplete model-reported coverage prominent',()=>{
  const song={id:'s',title:'Synthetic'} as Song;
  const job={id:'j',songId:'s',status:'review',progress:'Draft ready',baseRevision:2,createdAt:'2026-10-28',workflow:{id:'bounded',version:1},partial:true,coverageComplete:false,coverage:{'page-1':true,'page-2':false}} as unknown as Job;
  const markup=renderToStaticMarkup(createElement(RecognitionWorkflowSummary,{song,job}));
  assert.match(markup,/部分识谱草稿/);
  assert.match(markup,/模型报告/);
  assert.match(markup,/page-2/);
});
