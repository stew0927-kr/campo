// Field survey file (docs/mobile/SPEC-mobile.md). The survey app (apps/mobile) exports it, the editor imports it.
// Shape is checked by data/schema/survey.schema.json. Map changes travel as an ordinary changeset; photos and sensor
// readings stay in this file and never enter the map data. No field says who surveyed, on which device, or along which track.
import type { Changeset } from '../changeset/types.ts';

// The editor keeps imported surveys as data/surveys/{id}/survey.json and data/surveys/{id}/photos/.
export const SURVEY_FILE = 'survey.json';
export const SURVEY_PHOTOS_DIR = 'photos';
export const SURVEY_FORMAT = 'campo-survey';
export const SURVEY_VERSION = 1;

/** What is known about one photo. */
export interface PhotoMeta {
  /** Direction the photo looks, degrees clockwise from north, 0 up to 360. */
  heading_deg?: number;
  /** How heading_deg was set: the sensor value as taken, checked on the dial, or set by hand without a sensor value. */
  heading_source?: 'sensor' | 'dial' | 'manual';
  /** The compass value when the photo was taken, before any dial correction (for measuring the compass error). */
  heading_sensor_deg?: number;
  /** Compass accuracy class when the photo was taken (expo-location: 3 best, 0 unreliable). */
  heading_accuracy?: 0 | 1 | 2 | 3;
  /** Whether heading_sensor_deg was against true or magnetic north. Left out when not known. */
  heading_ref?: 'true' | 'magnetic';
  /** ISO 8601 with offset: when this photo was taken (the attachment's recorded_at is the record's). */
  captured_at?: string;
  /** EXIF FocalLength (mm). */
  focal_length_mm?: number;
  /** EXIF FocalLenIn35mmFilm (mm, 35 mm equivalent). */
  focal_length_35mm?: number;
  /** Horizontal field of view (degrees) worked out from the focal length and the photo's shape. */
  hfov_deg?: number;
  /** Size of the photo as taken, in pixels (portrait when height_px > width_px). */
  width_px?: number;
  height_px?: number;
  /** What to look for in the photo, e.g. "사진 오른쪽 두 번째 문". */
  direction_hint?: string;
}

/** Photos and readings taken at one Feature. */
export interface SurveyAttachment {
  /** ISO 8601 date-time with a time zone. */
  recorded_at: string;
  /** "photos/<name>.jpg", inside the survey folder. */
  photos?: string[];
  /** Per photo (key: its path in `photos`): the direction it looks. Older files have none. */
  photo_meta?: Record<string, PhotoMeta>;
  /** Degrees clockwise from magnetic north, 0 up to 360 (phone held flat). */
  heading_mag_deg?: number;
  pressure_hpa?: number;
  note?: string;
  /** What the surveyor read on site (the same values go onto the point with setProps; this is the record of where they came from). */
  hours?: string;
  closed_period?: string;
  access_condition?: string;
  /** The point's floor-copy group when it was surveyed. */
  sync_group?: string;
}

/** Height measured with the barometer along one edge. */
export interface VerticalMeasurement {
  edge_id: string;
  pressure_start_hpa: number;
  pressure_end_hpa: number;
  /** Rise from the edge's `from` to its `to`; negative when it goes down. */
  height_m: number;
  /** Left out when the two ends are at the same spot. */
  grade_pct?: number;
  method: 'barometer';
  measured_at: string;
}

/**
 * A travel time timed on site with the app's stopwatch (an escalator ride). The same shape as an observations/*.jsonl line
 * (SPEC-v0.2 3.9) without `source`: everything in a survey file is a field measurement, so it becomes `source: "field"`
 * (surveyObservations) and the calibration counts it twice.
 */
export interface SurveyTiming {
  /** "edge:<edge id>". */
  target: string;
  duration_sec: number;
  /** Ridden as drawn (default) or against it. */
  direction?: 'forward' | 'backward';
  measured_at: string;
}

export interface Survey {
  format: typeof SURVEY_FORMAT;
  version: typeof SURVEY_VERSION;
  /** "sv-{yyyymmdd}-{slug}" */
  id: string;
  campus: string;
  surveyed_at: string;
  /** Left out when nothing on the map changed. */
  changeset?: Changeset;
  /** By Feature id. */
  attachments: Record<string, SurveyAttachment>;
  vertical: VerticalMeasurement[];
  /** Stopwatch times; left out when none were taken (older files have none). */
  timings?: SurveyTiming[];
}
