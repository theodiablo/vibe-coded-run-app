// @ts-nocheck
import { Capacitor } from "@capacitor/core";

// True only inside the Phase-2 Capacitor shell; false in every browser (the pure
// web build). A SINGLE bundle serves both — `Capacitor.isNativePlatform()`
// returns false on the web, so every native-only path is gated on this flag and
// the web app behaves exactly as it did in Phase 1.
export const isNative = Capacitor.isNativePlatform();

// Public signal that the app is running inside the native shell, for any
// consumer that can't import this module (external scripts, analytics, manual
// debugging). The app itself branches on the `isNative` export above.
if (typeof window !== "undefined" && isNative) {
  window.__NATIVE_SHELL__ = true;
}
