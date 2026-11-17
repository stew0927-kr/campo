// Metro for the monorepo: the app imports @campo/core straight from packages/core/src (TypeScript source, no build step).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole repository so packages/core (linked into node_modules by npm workspaces) and data/schema are bundled and hot-reloaded.
config.watchFolders = [monorepoRoot];
// The app's own node_modules first, then the hoisted ones at the root.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(monorepoRoot, 'node_modules')];

// One copy of React. The editor pins another patch version at the repository root, and React Native refuses to run with
// a React that is not exactly its renderer's version, so every `react` import resolves as if it came from the app.
const fromApp = path.join(projectRoot, 'index.ts');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return context.resolveRequest({ ...context, originModulePath: fromApp }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
