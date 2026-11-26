// 브라우저에서 고른 사진을 webp 두 장(원본 1280px · 썸네일 128px)으로 바꾼다. 크기·품질은 photoModel(파이프라인과 같은 값).
// EXIF 회전은 createImageBitmap(imageOrientation: 'from-image')이 맞춘다. 2 MB를 넘으면 품질을 낮춰 다시 만든다.
import { FULL, MAX_BYTES, THUMB, WEBP, fitInside, qualitySteps } from './photoModel.ts';
import type { Variants } from './photoStore.ts';

export class WebpError extends Error {}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new WebpError('사진을 WebP로 바꾸지 못했습니다.'))), WEBP, quality));
}

async function variant(bitmap: ImageBitmap, spec: { size: number; quality: number }): Promise<Blob> {
  const { width, height } = fitInside(bitmap.width, bitmap.height, spec.size);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new WebpError('이 브라우저에서 사진을 그리지 못했습니다.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  for (const quality of qualitySteps(spec.quality)) {
    const blob = await encode(canvas, quality);
    // WebP를 못 만드는 브라우저는 PNG를 돌려준다: 버킷이 받지 않으므로 여기서 멈춘다.
    if (blob.type !== WEBP) throw new WebpError('이 브라우저는 WebP를 만들지 못합니다. 크롬이나 엣지에서 다시 해 주세요.');
    if (blob.size <= MAX_BYTES) return blob;
  }
  throw new WebpError('사진을 2 MB 아래로 줄이지 못했습니다. 더 작은 사진을 골라 주세요.');
}

export async function toWebpVariants(file: Blob): Promise<Variants> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    throw new WebpError('이 파일은 사진으로 읽지 못했습니다. JPG·PNG·WebP 사진을 골라 주세요.');
  }
  try { return { full: await variant(bitmap, FULL), thumb: await variant(bitmap, THUMB) }; } finally { bitmap.close(); }
}
