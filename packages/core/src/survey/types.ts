// Field survey file (docs/mobile/SPEC-mobile.md). The survey app (apps/mobile) exports it, the editor imports it.
// Shape is checked by data/schema/survey.schema.json. Map changes travel as an ordinary changeset; photos and sensor
// readings stay in this file and never enter the map data. No field says who surveyed, on which device, or along which track.
import type { Changeset } from '../changeset/types.ts';

// The editor keeps imported surveys as data/surveys/{id}/survey.json and data/surveys/{id}/photos/.
export const SURVEY_FILE = 'survey.json';
export const SURVEY_PHOTOS_DIR = 'photos';
export const SURVEY_FORMAT = 'campo-survey';
export const SURVEY_VERSION = 1;

/** Photos and readings taken at one Feature. */
export interface SurveyAttachment {
  /** ISO 8601 date-time with a time zone. */
  recorded_at: string;
  /** "photos/<name>.jpg", inside the survey folder. */
  photos?: string[];
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
}
