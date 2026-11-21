// What a stored survey photo must be: a JPEG. session.addPhotos names every photo "photos/<id>-<n>.jpg" and the store
// copies the bytes as they are, so whatever reaches the store has to be JPEG already. The camera (takePictureAsync)
// writes JPEG; a gallery pick can hand back the phone's original HEIC, so CameraCapture re-encodes it first and checks
// the result here. Pure, so it is tested in Node.

/** JPEG quality for every survey photo (camera and re-encoded gallery picks): enough to tell which door it is. */
export const PHOTO_JPEG_QUALITY = 0.6;

/**
 * Whether a file URI names a .jpg / .jpeg file (any letter case), looking at the path only (a ?query or #fragment is
 * ignored). URIs with no extension — iOS `ph://…`, Android `content://…` — are not taken as JPEG: nothing in them says
 * what the bytes are.
 */
export function isJpegUri(uri: string): boolean {
  const path = uri.split(/[?#]/, 1)[0] ?? '';
  const name = path.slice(path.lastIndexOf('/') + 1);
  return /\.jpe?g$/i.test(name);
}
