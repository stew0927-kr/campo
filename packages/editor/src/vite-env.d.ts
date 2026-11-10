/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Campus folder under data/campuses/ to edit. Default: hanyang-seoul. */
  readonly VITE_CAMPUS_ID?: string;
  /** 국토지리정보원 영상지도 API key (SPEC §3 배경 지도). Not in Git: put it in packages/editor/.env. */
  readonly VITE_NGII_API_KEY?: string;
  /** Tile URL template for the NGII imagery, with {key}, {z}, {x}, {y}. Decided in M2 (SPEC §11). */
  readonly VITE_NGII_TILE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
