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
      // Story 7.4 FR51 — required when the app calls
      // `expo-audio`'s record() API for the voice memo flow. pt-BR
      // per UX-DR20.
      NSMicrophoneUsageDescription:
        "Permita o acesso ao microfone para gravar um memo de voz junto do seu exame.",
      // Story 2.2 FR2 — required when the app calls
      // `ImagePicker.launchCameraAsync` for direct camera capture
      // (AC2). pt-BR per UX-DR20; names the action so App Store
      // review sees context, not just "this app".
      NSCameraUsageDescription:
        "Permita o acesso à câmera para fotografar resultados de exames.",
    },
  },
  android: {
    package: "your.bundle.identifier",
    adaptiveIcon: {
      foregroundImage: "./assets/icon-light.png",
      backgroundColor: "#1F104A",
    },
    edgeToEdgeEnabled: true,
    // Story 7.4 FR51 — required for `expo-audio` recording on Android.
    permissions: ["android.permission.RECORD_AUDIO"],
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
      // Story 7.4 FR51 — config-plugin form duplicates the
      // `infoPlist.NSMicrophoneUsageDescription` so a future Expo
      // Prebuild reshape can't drop it. pt-BR per UX-DR20.
      "expo-audio",
      {
        microphonePermission:
          "Permita o acesso ao microfone para gravar um memo de voz junto do seu exame.",
      },
    ],
    [
      // Story 2.5 / F135 — push notifications. iOS APNs entitlements
      // and Android FCM are wired by the config plugin; the runtime
      // hook (`apps/expo/src/hooks/use-push-notifications.ts`) handles
      // permission request + token registration. Real delivery
      // requires an EAS project (set `extra.eas.projectId`).
      "expo-notifications",
      {
        icon: "./assets/icon-light.png",
        color: "#0D6E6E",
      },
    ],
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
