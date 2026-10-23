const base = require('../../jest.config');
module.exports = {
  ...base,
  rootDir: '../..',
  resolver: '<rootDir>/test/headless/resolver.cjs',
  transform: { ...base.transform, '\\.(png|jpg|jpeg|gif|webp|ttf)$': '<rootDir>/test/headless/asset.cjs' },
  testEnvironment: '<rootDir>/test/headless/environment.cjs',
  roots: ['<rootDir>/test/headless'],
  testMatch: ['**/actor.test.ts'],
  testTimeout: 180000,
};
