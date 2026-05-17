// Learn more: https://docs.expo.dev/guides/monorepos/
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");
const { withSentryConfig } = require("@sentry/react-native/metro");

const config = getDefaultConfig(__dirname);

// Required for Tamagui package exports resolution (AR2)
config.resolver.unstable_enablePackageExports = true;

config.cacheStores = [
  new FileStore({
    root: path.join(__dirname, "node_modules", ".cache", "metro"),
  }),
];

/** @type {import('expo/metro-config').MetroConfig} */
let finalConfig = withSentryConfig(config);

// Restore Tamagui requirement if Sentry wrapper reset it
finalConfig.resolver.unstable_enablePackageExports = true;

module.exports = finalConfig;
