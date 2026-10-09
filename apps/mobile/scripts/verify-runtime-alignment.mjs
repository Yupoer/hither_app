import { readFileSync, existsSync } from 'node:fs';

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const fail = (message) => {
  console.error(`runtime alignment failed: ${message}`);
  process.exitCode = 1;
};

const pkg = json('package.json');
const app = json('app.json').expo;
const pods = json('ios/Podfile.properties.json');
const lock = readFileSync('ios/Podfile.lock', 'utf8');

// Bare workflow requires a string runtimeVersion that matches the app version.
if (typeof app.runtimeVersion !== 'string' || app.runtimeVersion !== app.version) {
  fail('runtimeVersion must be a string matching the app version');
}
// Bare iOS archives read checked-in native files, rather than app.json alone.
const nativeUpdates = readFileSync('ios/Hither/Supporting/Expo.plist', 'utf8');
const nativeRuntime = nativeUpdates.match(/<key>EXUpdatesRuntimeVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
if (nativeRuntime !== app.runtimeVersion) {
  fail('iOS Expo.plist runtime differs from app.json runtimeVersion');
}
const xcodeProject = readFileSync('ios/Hither.xcodeproj/project.pbxproj', 'utf8');
const nativeVersions = [...xcodeProject.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1]);
if (nativeVersions.length < 4 || nativeVersions.some((version) => version !== app.version)) {
  fail('iOS App/Widget marketing versions differ from app.json version');
}
if (!['hermes', 'jsc'].includes(pods['expo.jsEngine'])) {
  fail('ios expo.jsEngine must be hermes or jsc');
}
if (app.ios?.jsEngine && app.ios.jsEngine !== pods['expo.jsEngine']) {
  fail('app.json ios.jsEngine differs from Podfile.properties.json');
}

const rn = pkg.dependencies['react-native'];

/** Hermes pod version: RN 0.85+ defaults to Hermes V1 via hermes-compiler; older RN used RN version. */
function expectedHermesVersion() {
  try {
    const rnPkgPath = 'node_modules/react-native/package.json';
    if (existsSync(rnPkgPath)) {
      const hermesCompiler = json(rnPkgPath).dependencies?.['hermes-compiler'];
      if (typeof hermesCompiler === 'string' && hermesCompiler.length > 0) {
        return hermesCompiler;
      }
    }
  } catch {
    // fall through
  }
  return rn;
}

if (pods['expo.jsEngine'] === 'hermes') {
  const hermesVersion = expectedHermesVersion();
  if (!lock.includes(`hermes-engine (${hermesVersion})`)) {
    fail(`Podfile.lock Hermes does not match expected ${hermesVersion} (RN ${rn})`);
  }
}
if (pods['expo.jsEngine'] === 'jsc' && lock.includes('hermes-engine (')) {
  fail('JSC build still locks hermes-engine');
}

if (!process.exitCode) console.log('runtime alignment ok');
