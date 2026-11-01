const base = require('../../jest.config');
module.exports = {
  ...base,
  transform: { ...base.transform, '\\.(png|jpg|jpeg|gif|webp|ttf)$': '<rootDir>/test/headless/asset.cjs' },
  testTimeout: 180000,
};
