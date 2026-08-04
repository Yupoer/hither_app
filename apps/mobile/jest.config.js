/**
 * Jest runs the TypeScript logic and react-test-renderer hook harnesses via
 * ts-jest, so `npm test` stays fast and green on Windows without the native
 * React Native / Expo toolchain.
 *
 * ts-jest is told to emit CommonJS (the app's tsconfig targets esnext modules
 * for the Metro/bundler), so Jest can require the compiled output.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Keep legacy screen tests out of the node-only runner; the recovery race
  // harness is explicitly included because it exercises a real hook lifecycle.
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/useGroupStateRecoveryRace.test.tsx',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          esModuleInterop: true,
          isolatedModules: true,
        },
      },
    ],
  },
};
