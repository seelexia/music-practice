import test from 'node:test';
import assert from 'node:assert/strict';
import {Microphone,micDefaults} from './microphone';

test('closing a pending microphone request releases the late stream without reconnecting',async()=>{
  let complete!:(stream:MediaStream)=>void,stops=0,connections=0;
  const stream={getTracks:()=>[{stop:()=>stops++}],getAudioTracks:()=>[{getSettings:()=>({}),stop:()=>stops++}]} as unknown as MediaStream;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise<MediaStream>(resolve=>complete=resolve)}}});
  const context={resume:async()=>{},audioWorklet:{addModule:async()=>{}},createMediaStreamSource:()=>{connections++;throw new Error('Canceled stream must not connect');}} as unknown as AudioContext;
  const mic=new Microphone(context),pending=mic.start(micDefaults);mic.stop();complete(stream);await pending.catch(()=>{});
  assert.equal(stops,1);assert.equal(connections,0);assert.equal(mic.stream,null);
});
test('selected input is requested exactly and superseded permission results release their tracks',async()=>{
  const pending:((stream:MediaStream)=>void)[]=[],requests:MediaStreamConstraints[]=[];let stops=0;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:(request:MediaStreamConstraints)=>{requests.push(request);return new Promise<MediaStream>(resolve=>pending.push(resolve));}}}});
  const context={resume:async()=>{},audioWorklet:{addModule:async()=>{}},createMediaStreamSource:()=>{throw new Error('Canceled stream must not connect');}} as unknown as AudioContext;
  const mic=new Microphone(context),first=mic.start(micDefaults,'usb-a'),second=mic.start(micDefaults,'usb-b');mic.stop();
  const stream={getTracks:()=>[{stop:()=>stops++}]} as unknown as MediaStream;pending.forEach(resolve=>resolve(stream));await Promise.all([first,second]);
  assert.deepEqual((requests[0].audio as MediaTrackConstraints).deviceId,{exact:'usb-a'});assert.deepEqual((requests[1].audio as MediaTrackConstraints).deviceId,{exact:'usb-b'});assert.equal(stops,2);assert.equal(mic.stream,null);
});
