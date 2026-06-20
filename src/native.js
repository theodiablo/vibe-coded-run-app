import { Capacitor } from "@capacitor/core";

// True only inside the Phase-2 Capacitor shell; false in every browser (the pure
// web build). A SINGLE bundle serves both — `Capacitor.isNativePlatform()`
// returns false on the web, so every native-only path is gated on this flag and
// the web app behaves exactly as it did in Phase 1.
export const isNative = Capacitor.isNativePlatform();

// Phase 1's tracker UI (LiveRunTracker.jsx) already hides the browser-only
// "keep this screen on" notice when window.__NATIVE_SHELL__ === true. Light it
// up inside the shell so that detection works without touching the UI.
if (typeof window !== "undefined" && isNative) {
  window.__NATIVE_SHELL__ = true;
}
