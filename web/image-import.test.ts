import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {isAvifImage, prepareImageUpload} from './image-import.ts';

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const exportHint = /本机.*PNG\/JPG.*上传/;

function replaceGlobal(t: TestContext, name: string, value: unknown) {
 const previous = Object.getOwnPropertyDescriptor(globalThis, name);
 Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
 t.after(() => {
  if (previous) Object.defineProperty(globalThis, name, previous);
  else Reflect.deleteProperty(globalThis, name);
 });
}

type BrowserOptions = {
 width?: number;
 height?: number;
 decodeError?: boolean;
 canvasError?: boolean;
 noContext?: boolean;
 drawError?: boolean;
 encodeError?: boolean;
 blob?: Blob | null;
};

function browser(t: TestContext, options: BrowserOptions = {}) {
 const decoded: Blob[] = [];
 const draws: unknown[][] = [];
 const encodings: (string | undefined)[] = [];
 let closed = 0;
 let canvases = 0;
 const bitmap = {
  width: options.width ?? 1237,
  height: options.height ?? 8091,
  close() { closed++; },
 } as ImageBitmap;
 const canvas = {
  width: 0,
  height: 0,
  getContext(kind: string) {
   assert.equal(kind, '2d');
   return options.noContext ? null : {
    drawImage(...args: unknown[]) {
     if (options.drawError) throw new Error('draw failed');
     draws.push(args);
    },
   };
  },
  toBlob(callback: BlobCallback, mime?: string) {
   encodings.push(mime);
   if (options.encodeError) throw new Error('encode failed');
   callback(options.blob === undefined ? new Blob([pngBytes], {type: 'image/png'}) : options.blob);
  },
 };
 replaceGlobal(t, 'createImageBitmap', async (source: Blob) => {
  decoded.push(source);
  if (options.decodeError) throw new Error('unsupported AVIF');
  return bitmap;
 });
 replaceGlobal(t, 'document', {
  createElement(tag: string) {
   assert.equal(tag, 'canvas');
   canvases++;
   if (options.canvasError) throw new Error('allocation failed');
   return canvas;
  },
 });
 return {decoded, draws, encodings, bitmap, canvas, closed: () => closed, canvases: () => canvases};
}

test('AVIF detection accepts either case-insensitive extension or MIME', () => {
 for (const [name, type, expected] of [
  ['谱图.AVIF', '', true],
  ['谱图.avif', 'application/octet-stream', true],
  ['谱图.data', 'IMAGE/AVIF', true],
  ['谱图', 'image/avif; codecs=av01', true],
  ['谱图.avif.png', 'image/png', false],
  ['谱图', 'image/avif-other', false],
  ['谱图.jpeg', 'image/jpeg', false],
 ] as const) assert.equal(isAvifImage({name, type}), expected, `${name}: ${type}`);
});

test('other formats and non-image asset kinds return the original File without decoding', async t => {
 const api = browser(t);
 for (const [name, type, kind] of [
  ['谱图.png', 'image/png', 'score'],
  ['封面.jpg', 'image/jpeg', 'cover'],
  ['封面.webp', 'image/webp', 'cover'],
  ['audio.avif', 'image/avif', 'audio'],
  ['video.avif', 'image/avif', 'video'],
  ['archive.avif', 'image/avif', 'anything-else'],
 ]) {
  const file = new File(['original'], name, {type});
  assert.equal(await prepareImageUpload(file, kind), file);
 }
 assert.equal(api.decoded.length, 0);
 assert.equal(api.canvases(), 0);
});

for (const kind of ['score', 'cover']) {
 test(`${kind} AVIF becomes a separate PNG at original dimensions with preserved source bytes and timestamp`, async t => {
  const api = browser(t);
  const bytes = new Uint8Array([0, 1, 7, 255, 9]);
  const source = new File([bytes], '谱图.page.AVIF', {type: 'image/avif', lastModified: 1720000000123});
  const result = await prepareImageUpload(source, kind);
  assert.notEqual(result, source);
  assert.equal(result.name, '谱图.page.png');
  assert.equal(result.type, 'image/png');
  assert.equal(result.lastModified, 1720000000123);
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), pngBytes);
  assert.equal(source.name, '谱图.page.AVIF');
  assert.equal(source.type, 'image/avif');
  assert.equal(source.lastModified, 1720000000123);
  assert.deepEqual(new Uint8Array(await source.arrayBuffer()), bytes);
  assert.deepEqual(api.decoded, [source]);
  assert.equal(api.canvas.width, 1237);
  assert.equal(api.canvas.height, 8091);
  assert.deepEqual(api.draws, [[api.bitmap, 0, 0]]);
  assert.deepEqual(api.encodings, ['image/png']);
  assert.equal(api.closed(), 1);
 });
}

test('MIME-detected AVIF without an extension keeps its stem in the PNG name', async t => {
 browser(t);
 const result = await prepareImageUpload(new File(['avif'], '封面', {type: 'image/avif'}), 'cover');
 assert.equal(result.name, '封面.png');
});

test('empty or oversized AVIF is rejected before decoding or allocating a canvas', async t => {
 const api = browser(t);
 const oversized = new File(['small fixture'], 'oversized.avif');
 Object.defineProperty(oversized, 'size', {value: 104857601});
 for (const file of [new File([], 'empty.avif'), oversized]) {
  await assert.rejects(prepareImageUpload(file, 'score'), exportHint);
 }
 assert.equal(api.decoded.length, 0);
 assert.equal(api.canvases(), 0);
});

test('AVIF at the 100 MiB limit can be converted without changing its dimensions', async t => {
 const api = browser(t, {width: 8000, height: 5000});
 const file = new File(['small fixture'], 'limit.avif');
 Object.defineProperty(file, 'size', {value: 104857600});
 assert.equal((await prepareImageUpload(file, 'score')).type, 'image/png');
 assert.equal(api.canvas.width, 8000);
 assert.equal(api.canvas.height, 5000);
 assert.equal(api.closed(), 1);
});

test('unavailable browser decoding gives local PNG/JPG export instructions', async t => {
 replaceGlobal(t, 'createImageBitmap', undefined);
 await assert.rejects(prepareImageUpload(new File(['avif'], 'page.avif'), 'score'), exportHint);
});

test('corrupt or unsupported AVIF decoding gives local export instructions and preserves the source', async t => {
 const api = browser(t, {decodeError: true});
 const file = new File(['corrupt avif'], 'page.avif');
 await assert.rejects(prepareImageUpload(file, 'score'), exportHint);
 assert.equal(await file.text(), 'corrupt avif');
 assert.equal(api.canvases(), 0);
 assert.equal(api.closed(), 0);
});

for (const [name, width, height] of [
 ['zero width', 0, 100],
 ['negative height', 100, -2],
 ['non-finite dimensions', NaN, 100],
 ['fractional dimensions', 100.5, 100],
 ['too many pixels', 8000, 5001],
 ['unsupported canvas side', 32768, 1],
] as const) {
 test(`${name} rejects AVIF before canvas allocation and closes the bitmap`, async t => {
  const api = browser(t, {width, height});
  await assert.rejects(prepareImageUpload(new File(['avif'], 'page.avif'), 'score'), exportHint);
  assert.equal(api.canvases(), 0);
  assert.equal(api.closed(), 1);
 });
}

const oversizedPng = new Blob([pngBytes], {type: 'image/png'});
Object.defineProperty(oversizedPng, 'size', {value: 104857601});

for (const [name, options] of [
 ['canvas allocation failure', {canvasError: true}],
 ['unavailable canvas context', {noContext: true}],
 ['canvas drawing failure', {drawError: true}],
 ['PNG encoding exception', {encodeError: true}],
 ['null PNG result', {blob: null}],
 ['empty PNG result', {blob: new Blob([], {type: 'image/png'})}],
 ['non-PNG encoder result', {blob: new Blob(['jpeg'], {type: 'image/jpeg'})}],
 ['PNG larger than the upload limit', {blob: oversizedPng}],
] as const) {
 test(`${name} closes the bitmap and gives actionable local export instructions`, async t => {
  const api = browser(t, options);
  await assert.rejects(prepareImageUpload(new File(['avif'], 'page.avif'), 'score'), exportHint);
  assert.equal(api.closed(), 1);
 });
}
