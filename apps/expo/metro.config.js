// Learn more: https://docs.expo.dev/guides/monorepos/
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");

const config = getDefaultConfig(__dirname);

// Required for Tamagui package exports resolution (AR2)
config.resolver.unstable_enablePackageExports = true;

config.cacheStores = [
  new FileStore({
    root: path.join(__dirname, "node_modules", ".cache", "metro"),
  }),
];

/** @type {import('expo/metro-config').MetroConfig} */
module.exports = config;
