import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const rootModule = (name: string) => fileURLToPath(new URL(`../../../../node_modules/${name}`, import.meta.url));
export default defineConfig({
  root: local('./'), plugins: [react()], define: { __DEV__: true },
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
    { find: /.*\/MapCanvas(?:\.web)?\.tsx$/, replacement: local('./map.tsx') },
    { find: /.*\/PhotoViewerModal\.tsx$/, replacement: local('./photos.tsx') },
    { find: /.*\/RoadviewScreen\.tsx$/, replacement: local('./roadview.tsx') },
  ] },
  server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../../../', import.meta.url))] } },
});
