import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "expo",
  slug: "expo",
  scheme: "healthtracker",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon-light.png",
  userInterfaceStyle: "automatic",
  updates: {
    fallbackToCacheTimeout: 0,
  },
  newArchEnabled: true,
  assetBundlePatterns: ["**/*"],
  ios: {
    bundleIdentifier: "your.bundle.identifier",
    supportsTablet: true,
    icon: {
      light: "./assets/icon-light.png",
      dark: "./assets/icon-dark.png",
    },
    // Story 1.3 FR43 — required when the app calls
    // LocalAuthentication.authenticateAsync on a Face ID-capable device.
    // pt-BR per UX-DR20; App Store review requires the app name in the
    // usage string so users see context, not just "this app".
    infoPlist: {
      NSFaceIDUsageDescription:
        "Use Face ID para destravar o seu Health Tracker rapidamente.",
      // Story 1.5 FR2 — required when the app opens the photo library
      // via `expo-image-picker` (image upload of lab results). pt-BR
      // per UX-DR20.
      NSPhotoLibraryUsageDescription:
        "Permita o acesso à sua biblioteca de fotos para enviar resultados de exames.",
    },
  },
  android: {
    package: "your.bundle.identifier",
    adaptiveIcon: {
      foregroundImage: "./assets/icon-light.png",
      backgroundColor: "#1F104A",
    },
    edgeToEdgeEnabled: true,
  },
  // extra: {
  //   eas: {
  //     projectId: "your-eas-project-id",
  //   },
  // },
  experiments: {
    tsconfigPaths: true,
    typedRoutes: true,
    reactCanary: true,
    reactCompiler: true,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    [
      "expo-local-authentication",
      {
        // Story 1.3 FR43 — config-plugin form duplicates the
        // `infoPlist.NSFaceIDUsageDescription` string above so a future
        // Expo Prebuild reshape can't drop it. pt-BR per UX-DR20.
        faceIDPermission:
          "Use Face ID para destravar o seu Health Tracker rapidamente.",
      },
    ],
    [
      // Story 1.5 FR2 — config-plugin form duplicates the
      // `infoPlist.NSPhotoLibraryUsageDescription` string above.
      "expo-image-picker",
      {
        photosPermission:
          "Permita o acesso à sua biblioteca de fotos para enviar resultados de exames.",
      },
    ],
    "expo-document-picker",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#E4E4E7",
        image: "./assets/icon-light.png",
        dark: {
          backgroundColor: "#18181B",
          image: "./assets/icon-dark.png",
        },
      },
    ],
  ],
});
