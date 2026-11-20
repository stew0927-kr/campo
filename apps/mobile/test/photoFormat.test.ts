import { describe, expect, it } from 'vitest';
import { isJpegUri } from '../src/survey/photoFormat.ts';

describe('isJpegUri', () => {
  it('accepts .jpg and .jpeg in any letter case', () => {
    expect(isJpegUri('file:///cache/ImageManipulator/abc.jpg')).toBe(true);
    expect(isJpegUri('file:///cache/IMG_0001.JPG')).toBe(true);
    expect(isJpegUri('file:///cache/IMG_0001.Jpeg')).toBe(true);
  });
  it('ignores a ?query or #fragment after the path', () => {
    expect(isJpegUri('file:///cache/a.jpg?t=1')).toBe(true);
    expect(isJpegUri('file:///cache/a.heic?name=a.jpg')).toBe(false);
    expect(isJpegUri('file:///cache/a.jpg#x')).toBe(true);
  });
  it('rejects HEIC and other formats', () => {
    expect(isJpegUri('file:///cache/IMG_0001.HEIC')).toBe(false);
    expect(isJpegUri('file:///cache/a.heif')).toBe(false);
    expect(isJpegUri('file:///cache/a.png')).toBe(false);
  });
  it('does not take a URI with no extension as JPEG (ph://, content://), nor a ".jpg" that is only a folder name', () => {
    expect(isJpegUri('ph://9F983DBA-EC35-42B8-8773-B597CF782EDD/L0/001')).toBe(false);
    expect(isJpegUri('content://media/external/images/media/1234')).toBe(false);
    expect(isJpegUri('file:///cache/photo.jpg/data')).toBe(false);
    expect(isJpegUri('')).toBe(false);
  });
});
