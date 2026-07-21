// @ts-check
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Explicit resolve for react-refresh/* so DEV Android/iOS bundles don't fail
 * when Metro walks up from react-native/Libraries/Core (common after partial
 * node_modules repairs or omit-dev installs).
 */
const config = getDefaultConfig(__dirname);

const reactRefreshRoot = path.dirname(require.resolve('react-refresh/package.json'));

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  'react-refresh': reactRefreshRoot,
};

const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-refresh' || moduleName.startsWith('react-refresh/')) {
    try {
      const filePath = require.resolve(moduleName, { paths: [__dirname] });
      return { type: 'sourceFile', filePath };
    } catch {
      // fall through to default
    }
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
