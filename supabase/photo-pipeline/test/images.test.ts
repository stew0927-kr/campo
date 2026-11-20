// Real sharp conversions on generated images (no network): sizes, orientation, metadata removal.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { makeVariants } from '../src/images.ts';

const dir = mkdtempSync(join(tmpdir(), 'campo-img-'));

async function jpeg(name: string, width: number, height: number, withExif: boolean, orientation?: number): Promise<string> {
  const path = join(dir, name);
  let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } } }).jpeg({ quality: 90 });
  if (withExif) img = img.withExif({ IFD0: { Make: 'TestPhone', Model: 'X' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 33/1 25/1' } });
  let buf = await img.toBuffer();
  if (orientation) buf = await sharp(buf).withMetadata({ orientation }).toBuffer();
  writeFileSync(path, buf);
  return path;
}

describe('makeVariants', () => {
  it('long side 1280 / 128, WebP, aspect kept', async () => {
    const v = await makeVariants(await jpeg('wide.jpg', 4032, 3024, false));
    const full = await sharp(v.full).metadata();
    const thumb = await sharp(v.thumb).metadata();
    expect(full.format).toBe('webp');
    expect([full.width, full.height]).toEqual([1280, 960]);
    expect([thumb.width, thumb.height]).toEqual([128, 96]);
  });

  it('never enlarges a small photo', async () => {
    const v = await makeVariants(await jpeg('small.jpg', 800, 600, false));
    const full = await sharp(v.full).metadata();
    expect([full.width, full.height]).toEqual([800, 600]);
  });

  it('applies EXIF orientation (a portrait phone photo stands up)', async () => {
    // Stored 4032x3024 with orientation 6 (rotate 90°): it must come out portrait.
    const v = await makeVariants(await jpeg('rot.jpg', 4032, 3024, false, 6));
    const full = await sharp(v.full).metadata();
    expect([full.width, full.height]).toEqual([960, 1280]);
  });

  it('removes EXIF (GPS, device) from the output', async () => {
    const src = await jpeg('exif.jpg', 2000, 1500, true);
    expect((await sharp(src).metadata()).exif).toBeDefined();
    const v = await makeVariants(src);
    expect((await sharp(v.full).metadata()).exif).toBeUndefined();
    expect((await sharp(v.thumb).metadata()).exif).toBeUndefined();
  });
});
