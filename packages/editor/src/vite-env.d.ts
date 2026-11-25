/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Campus folder under data/campuses/ to edit. Default: hanyang-seoul. */
  readonly VITE_CAMPUS_ID?: string;
  /** 브이월드 위성지도 인증키(https://www.vworld.kr). */
  readonly VITE_VWORLD_API_KEY?: string;
  /** 'supabase' only in the build the admin web serves at /map/ (admin/scripts/build-map.mjs); otherwise the PC dev server. */
  readonly VITE_EDITOR_STORAGE?: string;
  /** Server build: the same project URL and publishable key as the admin web (never the secret key). */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
