import { Capacitor } from "@capacitor/core";

declare global {
  interface Window {
    __NATIVE_SHELL__?: boolean;
  }
}

// True only inside the Phase-2 Capacitor shell; false in every browser (the pure
// web build). A SINGLE bundle serves both — `Capacitor.isNativePlatform()`
// returns false on the web, so every native-only path is gated on this flag and
// the web app behaves exactly as it did in Phase 1.
export const isNative = Capacitor.isNativePlatform();

// Which shell we're in: "android" | "ios" | "web". `isNative` gates the
// native-vs-web split; these gate platform-exclusive integrations (Health
// Connect is Android-only, HealthKit is iOS-only). A synced preference naming
// the other platform's integration must degrade to "off" locally, never render
// its UI (the synced-preference / local-readiness doctrine).
export const platform = Capacitor.getPlatform();
export const isAndroid = platform === "android";
export const isIos = platform === "ios";

// Public signal that the app is running inside the native shell, for any
// consumer that can't import this module (external scripts, analytics, manual
// debugging). The app itself branches on the `isNative` export above.
if (typeof window !== "undefined" && isNative) {
  window.__NATIVE_SHELL__ = true;
}
