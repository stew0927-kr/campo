// The "hands": turn one original photo into two WebP files. sharp drops EXIF (GPS, device) unless asked to keep it,
// and .rotate() applies the EXIF orientation first so portrait iPhone photos do not lie on their side.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

export const FULL = { size: 1280, quality: 80 } as const;
export const THUMB = { size: 128, quality: 75 } as const;

export class HeicUnsupportedError extends Error {}

export interface Variants {
  full: Buffer;
  thumb: Buffer;
}

export const sha256Of = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

const isHeic = (path: string) => /\.(heic|heif)$/i.test(path);

/**
 * sharp's prebuilt binaries cannot read HEIC. On a Mac, the built-in `sips` turns it into a JPEG first;
 * elsewhere the photo is reported as a failure with a hint.
 */
function readable(path: string): Buffer {
  if (!isHeic(path)) return readFileSync(path);
  if (process.platform !== 'darwin') {
    throw new HeicUnsupportedError("HEIC 사진은 Mac에서만 자동 변환됩니다. 휴대폰 카메라 포맷을 '높은 호환성'(JPG)으로 바꾸거나 JPG로 변환해 주세요.");
  }
  const dir = mkdtempSync(join(tmpdir(), 'campo-heic-'));
  try {
    const out = join(dir, 'photo.jpg');
    execFileSync('sips', ['-s', 'format', 'jpeg', path, '--out', out], { stdio: 'ignore' });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Long side 1280 px (q80) and 128 px (q75), never enlarged, EXIF orientation applied, metadata removed. */
export async function makeVariants(path: string): Promise<Variants> {
  const input = readable(path);
  const make = (size: number, quality: number) =>
    sharp(input).rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer();
  const [full, thumb] = await Promise.all([make(FULL.size, FULL.quality), make(THUMB.size, THUMB.quality)]);
  return { full, thumb };
}
