// Native side of survey/photoFormat.ts: turn whatever the gallery handed back (possibly the phone's original HEIC) into a
// JPEG file. expo-image-manipulator ships inside Expo Go, so this needs no extra native module. It cannot run in Node;
// the testable decision lives in photoFormat.ts.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { PHOTO_JPEG_QUALITY, isJpegUri } from '../survey/photoFormat.ts';

/**
 * Decode `uri` and write it again as a JPEG, at the same pixel size (no resize: width_px / height_px / hfov_deg in the
 * record come from the original's EXIF and must still describe this file). The result has no EXIF and its orientation is
 * baked into the pixels; that is intended, the EXIF was read from the original before this call.
 * Throws when the decode or the write fails or the result is not a .jpg file, so a HEIC is never stored under a .jpg name.
 */
export async function reencodeAsJpeg(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  try {
    const image = await context.renderAsync();
    try {
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_JPEG_QUALITY });
      if (!isJpegUri(saved.uri)) throw new Error(`not a JPEG file: ${saved.uri}`);
      return saved.uri;
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
}
