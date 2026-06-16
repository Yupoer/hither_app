/**
 * Jest runs only the pure-TypeScript logic (API client + types) via ts-jest,
 * so `npm test` stays fast and green on Windows without the native
 * React Native / Expo toolchain. Component/screen tests can be added later
 * with jest-expo once a device/emulator workflow is in place.
 *
 * ts-jest is told to emit CommonJS (the app's tsconfig targets esnext modules
 * for the Metro/bundler), so Jest can require the compiled output.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
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
