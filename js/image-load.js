import { scaledSize } from './geometry.js';

function decodeWithImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ source: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

async function decode(file) {
  // <img> handles HEIC and EXIF orientation reliably on iOS Safari.
  try {
    return await decodeWithImg(file);
  } catch (e) {
    if (typeof createImageBitmap !== 'function') throw e;
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
  }
}

/** File -> { width, height, rgba, canvas }, scaled so the long side is at most 1024px. */
export async function loadImageFile(file) {
  const { source, w, h, done } = await decode(file);
  const { width, height } = scaledSize(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  done();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  return { width, height, rgba, canvas };
}
