import test from 'node:test';
import assert from 'node:assert/strict';
import {alignmentAtAudio,addAlignmentAnchor,estimateAlignmentTempo} from './alignment';
import {beatToAudio} from './core';
test('selected score beat aligns to the independent native audio clock',()=>{
 const alignment=alignmentAtAudio(8,7.25,120);assert.equal(alignment.offset,3.25);assert.equal(beatToAudio(8,120,alignment),7.25);assert.deepEqual(alignment.anchors,[]);
});
test('two raw-audio anchors estimate effective piano BPM without changing printed score BPM',()=>{
 const anchors=[{beat:4,seconds:2},{beat:20,seconds:10}];assert.deepEqual(estimateAlignmentTempo(anchors,60),{bpm:120,speed:2});assert.deepEqual(anchors,[{beat:4,seconds:2},{beat:20,seconds:10}]);
 assert.throws(()=>estimateAlignmentTempo([{beat:0,seconds:1}],60));assert.throws(()=>estimateAlignmentTempo([{beat:0,seconds:2},{beat:4,seconds:1}],60));assert.throws(()=>estimateAlignmentTempo([{beat:0,seconds:1},{beat:0,seconds:2}],60));assert.throws(()=>estimateAlignmentTempo([{beat:0,seconds:1},{beat:4,seconds:NaN}],60));
});
test('anchors are sorted, replace the same beat, and reject backwards audio time',()=>{
 const alignment={offset:0,anchors:[{beat:8,seconds:10}]};const next=addAlignmentAnchor(alignment,0,2,120);assert.deepEqual(next.anchors,[{beat:0,seconds:2},{beat:8,seconds:10}]);assert.equal(addAlignmentAnchor(next,8,11,120).anchors[1].seconds,11);assert.throws(()=>addAlignmentAnchor(next,4,12,120));assert.throws(()=>alignmentAtAudio(NaN,1,120));
});
