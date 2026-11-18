// The entry in a point's sheet (PointInfoSheet) that opens the photos already saved on that point.
// Plain TypeScript with no React Native import, so Node can test it.

/** The button that opens the photos saved on a point, and what pressing it opens. */
export interface SavedPhotosButton {
  /** How many photos the point keeps in this walk. */
  count: number;
  label: string;
  onPress: () => void;
}

/**
 * The button for the photos already saved on a point, or null when there is nothing to open: no saved photos, or no
 * way to open them. The photos themselves (their direction, and deleting one) live in PhotosSheet; without this entry
 * the app has no way to reach it, so a picture taken for a point can never be looked at or removed again.
 */
export function savedPhotosButton(savedPhotos: number | undefined, onManage: (() => void) | undefined): SavedPhotosButton | null {
  if (onManage === undefined || savedPhotos === undefined || savedPhotos <= 0) return null;
  return { count: savedPhotos, label: `저장된 사진 ${savedPhotos}장 보기·삭제`, onPress: onManage };
}
