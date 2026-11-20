// HEIC handling without network. Header buffers are synthetic (judging and routing only). One small real HEIC is committed
// in test/fixtures (see fixtures/README.md) so the decode itself is exercised too.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { HeicUnsupportedError, isHeicInput, looksHeic, makeVariants, sniffImage } from '../src/images.ts';

/** [size][ftyp][major][minor version][compatible brands...] and some payload, like the start of a real file. */
function ftyp(major: string, ...compatible: string[]): Buffer {
  const size = 16 + compatible.length * 4;
  const head = Buffer.alloc(size);
  head.writeUInt32BE(size, 0);
  head.write('ftyp', 4, 'latin1');
  head.write(major, 8, 'latin1');
  compatible.forEach((b, i) => head.write(b, 16 + i * 4, 'latin1'));
  return Buffer.concat([head, Buffer.alloc(64, 0x11)]);
}

const dir = mkdtempSync(join(tmpdir(), 'campo-heic-test-'));
const REAL_HEIC = join(import.meta.dirname, 'fixtures', 'quadrants-96x64.heic');
const put = (name: string, bytes: Buffer): string => {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
};

describe('looksHeic / sniffImage', () => {
  it.each(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif'])('major brand %s is HEIC', (brand) => {
    expect(looksHeic(ftyp(brand))).toBe(true);
  });

  it('finds a HEIC whose major brand is something else but lists heic / mif1 as compatible', () => {
    expect(looksHeic(ftyp('isom', 'iso2', 'heic'))).toBe(true);
    expect(looksHeic(ftyp('xxxx', 'mif1', 'miaf'))).toBe(true);
    expect(looksHeic(ftyp('isom', 'iso2', 'mp41'))).toBe(false); // an ordinary MP4
  });

  it('does not take AVIF (which also lists mif1) for HEIC: sharp reads AVIF itself', () => {
    expect(sniffImage(ftyp('avif', 'mif1', 'miaf'))).toBe('avif');
    expect(looksHeic(ftyp('mif1', 'avif', 'miaf'))).toBe(false);
  });

  it('is false for JPEG, PNG and WebP headers', () => {
    expect(looksHeic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]))).toBe(false);
    expect(looksHeic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).toBe(false);
    expect(looksHeic(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe(false);
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
  });

  it('is false, and never throws, for empty or tiny buffers and a cut-off ftyp box', () => {
    expect(looksHeic(Buffer.alloc(0))).toBe(false);
    expect(looksHeic(Buffer.from([0, 0, 0]))).toBe(false);
    expect(looksHeic(Buffer.from('ftyp'))).toBe(false);
    expect(looksHeic(ftyp('heic').subarray(0, 11))).toBe(false);
    expect(looksHeic(ftyp('heic').subarray(0, 12))).toBe(true); // major brand is complete
  });

  it('reads a real HEIC file', () => {
    expect(looksHeic(readFileSync(REAL_HEIC))).toBe(true);
  });
});

describe('isHeicInput: the header wins, the extension only fills in when the header says nothing', () => {
  it('HEIC bytes under a .jpg name are HEIC', () => expect(isHeicInput(ftyp('heic'), 'a.jpg')).toBe(true));
  it('JPEG bytes under a .heic name are not', () => expect(isHeicInput(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'a.HEIC')).toBe(false));
  it('unknown bytes fall back to the extension', () => {
    expect(isHeicInput(Buffer.alloc(0), 'a.heif')).toBe(true);
    expect(isHeicInput(Buffer.alloc(8), 'a.jpg')).toBe(false);
  });
});

describe('makeVariants routing', () => {
  it('sends HEIC bytes named .jpg to the converter, not straight to sharp, and names the file when it fails', async () => {
    // A valid HEIC header with garbage behind it: sharp would say "unsupported image format"; the converter must be tried.
    const path = put('looks-like.jpg', ftyp('heic', 'mif1'));
    const err = await makeVariants(path).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HeicUnsupportedError);
    expect((err as HeicUnsupportedError).path).toBe(path);
    expect((err as Error).message).toContain(basename(path));
    expect((err as Error).message).toContain('heic-convert');
  });

  it('a .heic name with unreadable bytes fails the same way', async () => {
    const path = put('broken.heic', Buffer.alloc(40, 7));
    await expect(makeVariants(path)).rejects.toBeInstanceOf(HeicUnsupportedError);
  });

  it('an empty .heic file fails with the file name, without throwing anything else', async () => {
    const path = put('empty.heic', Buffer.alloc(0));
    await expect(makeVariants(path)).rejects.toThrow(/empty\.heic/);
  });

  it('a real JPEG named .heic still gives two WebP files', async () => {
    const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer();
    const v = await makeVariants(put('really-jpeg.heic', jpeg));
    const full = await sharp(v.full).metadata();
    const thumb = await sharp(v.thumb).metadata();
    expect([full.format, full.width, full.height]).toEqual(['webp', 300, 200]);
    expect([thumb.format, thumb.width, thumb.height]).toEqual(['webp', 128, 85]);
  });
});

describe('real HEIC (test/fixtures/quadrants-96x64.heic)', () => {
  // Decoded by heic-convert (pure JS), then sharp: the quadrants must still be red / green / blue / yellow, upright.
  const corners = async (webp: Buffer): Promise<number[][]> => {
    const { data, info } = await sharp(webp).raw().toBuffer({ resolveWithObject: true });
    return [[10, 10], [80, 10], [10, 50], [80, 50]].map(([x, y]) => {
      const i = (y! * info.width + x!) * info.channels;
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    });
  };
  const near = (got: number[], want: number[]) => got.forEach((c, i) => expect(Math.abs(c - want[i]!)).toBeLessThan(30));

  for (const name of ['photo.heic', 'photo.HEIC', 'photo-named-jpg.jpg']) {
    it(`converts it when it is named ${name}`, async () => {
      const path = join(dir, name);
      copyFileSync(REAL_HEIC, path);
      const v = await makeVariants(path);
      const full = await sharp(v.full).metadata();
      const thumb = await sharp(v.thumb).metadata();
      expect([full.format, full.width, full.height]).toEqual(['webp', 96, 64]); // never enlarged
      expect([thumb.format, thumb.width, thumb.height]).toEqual(['webp', 96, 64]); // already smaller than 128
      expect(full.exif).toBeUndefined();
      const [tl, tr, bl, br] = await corners(v.full);
      near(tl!, [220, 30, 30]);
      near(tr!, [30, 200, 30]);
      near(bl!, [30, 30, 220]);
      near(br!, [230, 220, 30]);
    });
  }
});
