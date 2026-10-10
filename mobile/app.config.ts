import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "EventOS",
  slug: "ledbox-mobile",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  platforms: ["ios"],
  ios: {
    // iPhone only for this vertical. iPad requires a separate owner policy/QA.
    supportsTablet: false,
    ...(process.env.LEDBOX_IOS_BUNDLE_ID ? { bundleIdentifier: process.env.LEDBOX_IOS_BUNDLE_ID } : {}),
    ...(process.env.LEDBOX_APPLE_TEAM_ID ? { appleTeamId: process.env.LEDBOX_APPLE_TEAM_ID } : {}),
  },
  plugins: [["expo-secure-store", { configureAndroidBackup: false }]],
});
