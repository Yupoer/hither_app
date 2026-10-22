const base = require('../../jest.config');
module.exports = {
  ...base,
  rootDir: '../..',
  testEnvironment: '<rootDir>/test/headless/environment.cjs',
  roots: ['<rootDir>/test/headless'],
  testMatch: ['**/actor.test.ts'],
  testTimeout: 180000,
};
