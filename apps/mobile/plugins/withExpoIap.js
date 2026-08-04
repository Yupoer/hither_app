/**
 * expo-iap's config plugin currently writes informational messages to stdout.
 * Expo's `config --json` contract requires stdout to contain JSON only, so
 * keep the upstream plugin but silence its log-only output while it mutates
 * the config. Errors still go through Expo's normal error channel.
 */
const upstream = require('expo-iap/app.plugin');
const withExpoIap = upstream.default || upstream;

module.exports = function withExpoIapQuietly(config, options) {
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    return withExpoIap(config, options);
  } finally {
    console.log = originalLog;
  }
};
