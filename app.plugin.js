// Entry point for the config plugin, so consumers can simply add:
//
//   "plugins": ["expo-cisco-anyconnect"]
//
// to their app config. The implementation lives in TypeScript under plugin/src and is compiled to
// plugin/build by the package's `prepare`/`build` scripts.
const plugin = require('./plugin/build');

// The TypeScript build emits `exports.default`. Unwrap it so that this file itself resolves to the
// plugin function, which is what Expo and other tooling expect.
module.exports = plugin && plugin.default ? plugin.default : plugin;
