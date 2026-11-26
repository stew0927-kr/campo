import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const rootModule = (name: string) => fileURLToPath(new URL(`../../../../node_modules/${name}`, import.meta.url));
/** Only MapScreen's indoor fixture import goes to the harness switch (which itself reads the original JSON). */
const harnessFixture: Plugin = {
  name: 'campo-harness-fixture', enforce: 'pre',
  resolveId(source, importer) { return source.endsWith('/indoorFixture.json') && importer?.endsWith('/MapScreen.tsx') ? local('./indoorFixture.ts') : null; },
};
/**
 * Metro's `require('./x.png')` (TabBar's tab icons) does not exist in the browser: turn each into an import of the asset URL,
 * as `{ uri }` like a remote image, so the first screen renders. Test-only; the app source is not changed.
 */
const harnessRequireAssets: Plugin = {
  name: 'campo-harness-require-assets', enforce: 'pre',
  transform(code, id) {
    if (!/\/src\/.*\.tsx?$/.test(id) || !code.includes('require(')) return null;
    const imports: string[] = [];
    const out = code.replace(/require\((['"])([^'"]+\.(?:png|jpe?g|webp))\1\)/g, (_m, _q, path: string) => {
      const name = `__campoAsset${imports.length}`;
      imports.push(`import ${name} from ${JSON.stringify(path)};`);
      return `{ uri: ${name} }`;
    });
    return imports.length ? { code: `${imports.join('\n')}\n${out}`, map: null } : null;
  },
};
export default defineConfig({
  root: local('./'), plugins: [harnessFixture, harnessRequireAssets, react()], define: { __DEV__: true },
  resolve: { alias: [
    { find: /.*\/configured\.ts$/, replacement: local('./connection.ts') },
    { find: /^react$/, replacement: rootModule('react/index.js') },
    { find: /^react\/jsx-runtime$/, replacement: rootModule('react/jsx-runtime.js') },
    { find: /^react-native$/, replacement: local('./native.tsx') },
    { find: /^react-native-safe-area-context$/, replacement: local('./safeArea.tsx') },
    { find: /^expo-location$/, replacement: local('./location.ts') },
    { find: /^expo-sensors$/, replacement: local('./sensors.ts') },
    { find: /^expo-constants$/, replacement: local('./constants.ts') },
    { find: /^expo-status-bar$/, replacement: local('./statusBar.tsx') },
    { find: /^expo-image$/, replacement: local('./image.tsx') },
    { find: /^@maplibre\/maplibre-react-native$/, replacement: local('./maplibre.tsx') },
    { find: /.*\/MapCanvas(?:\.web)?\.tsx$/, replacement: local('./map.tsx') },
    { find: /.*\/PhotoViewerModal\.tsx$/, replacement: local('./photos.tsx') },
    // The real split roadview screen runs; only its native mini map is replaced.
    { find: /.*\/RoadviewMiniMap\.tsx$/, replacement: local('./miniMap.tsx') },
  ] },
  server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../../../', import.meta.url))] } },
});
