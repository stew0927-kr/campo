// The "hands": turn one original photo into two WebP files. sharp drops EXIF (GPS, device) unless asked to keep it,
// and .rotate() applies the EXIF orientation first so portrait iPhone photos do not lie on their side.
//
// HEIC: sharp's prebuilt binaries cannot read it, so a HEIC is turned into a JPEG first, on every OS. Whether a file is
// HEIC is decided by its BYTES (the ISO-BMFF "ftyp" box and its brands), not its name: the field survey app used to
// store a gallery pick as "photos/x.jpg" even when it was the phone's original HEIC. Order of trust: a recognised header
// wins; only when the header says nothing (empty, truncated, unknown) does the extension decide. So a HEIC named .jpg is
// converted, and a JPEG named .heic is not made to fail. Conversion: macOS tries the built-in `sips` first, then (and
// everywhere else) the pure-JS `heic-convert`. If both fail, HeicUnsupportedError carries the file path and the cause.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

export const FULL = { size: 1280, quality: 80 } as const;
export const THUMB = { size: 128, quality: 75 } as const;

/** A HEIC/HEIF photo could not be converted (no converter, or the decode failed). `path` is the photo, `cause` the reason. */
export class HeicUnsupportedError extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`${path}: HEIC 사진을 JPG로 변환하지 못했습니다 (${reason}). 휴대폰 카메라 포맷을 '높은 호환성'(JPG)으로 바꾸거나 JPG로 변환해 주세요.`, { cause });
    this.name = 'HeicUnsupportedError';
    this.path = path;
  }
}

export interface Variants {
  full: Buffer;
  thumb: Buffer;
}

export const sha256Of = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/** Brands of the HEIF family that carry HEVC pictures (HEIC) or are the generic HEIF brands that iPhones and Android write. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif']);
/** AVIF files also list the generic "mif1" brand, but sharp reads them itself: they must not be sent to the HEIC converter. */
const AVIF_BRANDS = new Set(['avif', 'avis']);

export type ImageKind = 'heic' | 'avif' | 'jpeg' | 'png' | 'webp' | 'unknown';

/**
 * What the first bytes of a file say it is. Never throws: a buffer too short to tell is 'unknown'.
 * A HEIC starts with an ISO-BMFF "ftyp" box: [size:4][ftyp][major brand:4][minor version:4][compatible brands:4 each...].
 * Both the major brand and the compatible brands are read, so a file whose major brand is unusual but lists "heic" or
 * "mif1" is still found. A brand list that also names avif/avis is AVIF.
 */
export function sniffImage(buf: Buffer): ImageKind {
  if (buf.length < 4) return 'unknown';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    // A box size of 0 means "to the end of the file"; a size beyond what was read (or too small) is clamped to the buffer.
    const declared = buf.readUInt32BE(0);
    const end = declared >= 16 && declared <= buf.length ? declared : buf.length;
    const brands: string[] = [buf.toString('latin1', 8, 12)];
    for (let at = 16; at + 4 <= end; at += 4) brands.push(buf.toString('latin1', at, at + 4));
    if (brands.some((b) => AVIF_BRANDS.has(b))) return 'avif';
    if (brands.some((b) => HEIC_BRANDS.has(b))) return 'heic';
  }
  return 'unknown';
}

/** Whether the bytes are a HEIC/HEIF picture (see sniffImage). */
export const looksHeic = (buf: Buffer): boolean => sniffImage(buf) === 'heic';

const HEIC_EXTENSION = /\.(heic|heif)$/i;

/** The header decides when it recognises the file; the extension only when the header says nothing. */
export function isHeicInput(buf: Buffer, path: string): boolean {
  const kind = sniffImage(buf);
  if (kind !== 'unknown') return kind === 'heic';
  return HEIC_EXTENSION.test(path);
}

/** macOS only: the built-in converter. Throws when `sips` is missing or cannot read the file. */
function convertWithSips(input: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'campo-heic-'));
  try {
    const src = join(dir, 'photo.heic');
    const out = join(dir, 'photo.jpg');
    writeFileSync(src, input);
    execFileSync('sips', ['-s', 'format', 'jpeg', src, '--out', out], { stdio: 'ignore' });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Pure JS (libheif compiled to WASM), so it works on Windows, Linux and macOS. heic-convert is CommonJS: it is loaded with
 * a dynamic import() at the moment it is needed (its `default` is the module.exports function; @types/heic-convert uses
 * `export =`, which this package's ESM + verbatimModuleSyntax settings accept as a default import). Loading it lazily also
 * keeps the WASM out of runs that never meet a HEIC, and turns "cannot load the converter" into a normal failure.
 * Quality 1: the JPEG is only an intermediate for sharp, so it should not be squeezed twice. libheif applies the
 * HEIC's own rotation to the pixels, and the JPEG carries no EXIF, so sharp's .rotate() later has nothing left to apply.
 */
async function convertWithHeicConvert(input: Buffer): Promise<Buffer> {
  const { default: convert } = await import('heic-convert');
  return Buffer.from(await convert({ buffer: input, format: 'JPEG', quality: 1 }));
}

/** JPEG bytes of a HEIC: sips first on a Mac, then heic-convert. Both failing throws HeicUnsupportedError (path + cause). */
async function heicToJpeg(input: Buffer, path: string): Promise<Buffer> {
  const causes: string[] = [];
  if (process.platform === 'darwin') {
    try {
      return convertWithSips(input);
    } catch (e) {
      causes.push(`sips: ${(e as Error).message.split('\n')[0] ?? 'failed'}`);
    }
  }
  try {
    return await convertWithHeicConvert(input);
  } catch (e) {
    causes.push(`heic-convert: ${(e as Error).message}`);
    throw new HeicUnsupportedError(path, new Error(causes.join('; '), { cause: e }));
  }
}

/** The bytes sharp can read: the file itself, or its JPEG conversion when the bytes (or, failing that, the name) say HEIC. */
async function readable(path: string): Promise<Buffer> {
  const bytes = readFileSync(path);
  return isHeicInput(bytes, path) ? heicToJpeg(bytes, path) : bytes;
}

/** Long side 1280 px (q80) and 128 px (q75), never enlarged, EXIF orientation applied, metadata removed. */
export async function makeVariants(path: string): Promise<Variants> {
  const input = await readable(path);
  const make = (size: number, quality: number) =>
    sharp(input).rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer();
  const [full, thumb] = await Promise.all([make(FULL.size, FULL.quality), make(THUMB.size, THUMB.quality)]);
  return { full, thumb };
}
