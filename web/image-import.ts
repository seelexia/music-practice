const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
// Bound canvas memory while keeping accepted images at their original resolution.
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_CANVAS_SIDE = 32_767;

function importError(reason: string): Error {
 return new Error(`${reason}；请在本机将原图导出为 PNG/JPG 后重新上传。`);
}

export function isAvifImage(file: Pick<File, 'name' | 'type'>): boolean {
 return /\.avif$/i.test(file.name) || file.type.split(';', 1)[0].trim().toLowerCase() === 'image/avif';
}

export async function prepareImageUpload(file: File, kind: string): Promise<File> {
 if ((kind !== 'score' && kind !== 'cover') || !isAvifImage(file)) return file;
 if (!file.size) throw importError('AVIF 文件为空');
 if (file.size > MAX_UPLOAD_BYTES) throw importError('AVIF 文件超过 100 MB 上传限制');
 if (typeof createImageBitmap !== 'function') throw importError('当前浏览器不支持 AVIF 图片解码');

 let bitmap: ImageBitmap;
 try {
  bitmap = await createImageBitmap(file);
 } catch {
  throw importError('浏览器无法解码此 AVIF 图片');
 }

 try {
  const {width, height} = bitmap;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
   throw importError('AVIF 图片尺寸无效');
  }
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_IMAGE_PIXELS) {
   throw importError('AVIF 图片过大，原尺寸转换最多支持 4000 万像素且单边不超过 32767 像素');
  }

  let png: Blob | null;
  try {
   const canvas = document.createElement('canvas');
   canvas.width = width;
   canvas.height = height;
   const context = canvas.getContext('2d');
   if (!context) throw new Error('Canvas 2D context unavailable');
   context.drawImage(bitmap, 0, 0);
   png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  } catch {
   throw importError('浏览器无法将此 AVIF 图片转换为 PNG');
  }
  if (!png?.size || png.type.toLowerCase() !== 'image/png') throw importError('浏览器未能生成有效的 PNG 图片');
  if (png.size > MAX_UPLOAD_BYTES) throw importError('转换后的 PNG 超过 100 MB 上传限制');
  const extension = file.name.lastIndexOf('.');
  const stem = extension > 0 ? file.name.slice(0, extension) : file.name;
  return new File([png], `${stem || 'image'}.png`, {type: 'image/png', lastModified: file.lastModified});
 } finally {
  bitmap.close();
 }
}
