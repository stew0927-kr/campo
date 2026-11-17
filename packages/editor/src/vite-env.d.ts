/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Campus folder under data/campuses/ to edit. Default: hanyang-seoul. */
  readonly VITE_CAMPUS_ID?: string;
  /** 브이월드 위성지도 인증키(https://www.vworld.kr). */
  readonly VITE_VWORLD_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
