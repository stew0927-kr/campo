// Where an applied floorplan draft is kept on the server. 조원 D's campus_map_files table is not open yet, so the
// default store does nothing; a real one only has to implement save(). A failed save never takes the map change back.

export interface FloorplanDraftRecord {
  campus: string;
  buildingId: string;
  level: number;
  rotationDeg: number;
  geojson: unknown;
  createdAt: string;
}

export interface FloorplanDraftStore {
  save(record: FloorplanDraftRecord): Promise<void>;
}

/** 서버 테이블이 아직 없을 때: 아무것도 하지 않는다. */
export function noopFloorplanStore(): FloorplanDraftStore {
  return { save: async () => {} };
}
