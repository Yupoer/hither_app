/**
 * Guards against transitive version drift of Expo native modules.
 *
 * Bug it prevents: a transitive dependency (e.g. @expo/vector-icons declaring
 * `expo-font: ">=14.0.4"`) can make npm hoist a NEWER major of a native module
 * to the top of node_modules than the installed Expo SDK ships native code for.
 * Metro then loads the mismatched JS, the matching native pod is never built,
 * and the app crashes at runtime with:
 *   "Cannot find native module 'ExpoFontLoader'".
 *
 * `expo install --check` / `expo-doctor` only inspect DIRECT dependencies in
 * package.json, so they do NOT catch this. This test does: it compares the
 * version JS will actually resolve (the hoisted, top-level copy) against the
 * version range the current Expo SDK pins in `expo/bundledNativeModules.json`.
 */
// require (not import) so the test has no compile-time dependency on @types/semver.
const semver = require('semver');

// The exact files Metro/the bundler resolves at runtime — top-level (hoisted)
// copies, not the nested ones under expo/. These are what ship to the device.
const bundledNativeModules: Record<string, string> = require('expo/bundledNativeModules.json');

function resolvedVersion(pkg: string): string | null {
  try {
    const pkgJsonPath = require.resolve(`${pkg}/package.json`);
    return require(pkgJsonPath).version as string;
  } catch {
    return null; // not installed — not our concern here
  }
}

describe('Expo native module versions', () => {
  it('every installed native module matches the SDK-pinned range', () => {
    const mismatches: string[] = [];

    for (const [pkg, range] of Object.entries(bundledNativeModules)) {
      const installed = resolvedVersion(pkg);
      if (installed === null) continue; // package not installed

      if (!semver.satisfies(installed, range, { includePrerelease: true })) {
        mismatches.push(
          `${pkg}: resolved ${installed} does NOT satisfy SDK range "${range}". ` +
            `A transitive dep likely hoisted a wrong version — pin it via "overrides".`
        );
      }
    }

    expect(mismatches).toEqual([]);
  });
});
