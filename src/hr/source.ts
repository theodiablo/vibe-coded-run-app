import { isAndroid, isIos, platform } from "../native";
import { bleSource } from "./ble";
import { healthConnectSource } from "./healthconnect";
import { healthKitSource } from "./healthkit";
import type { HrMethod } from "../types";

// Resolve the heart-rate source for a chosen method, or null for "off" / web /
// unknown. Mirrors geoSource (src/geo/source.ts): HR capture is native-only, so
// the web build always gets null and behaves exactly as before. Callers branch on
// the returned source's `live` flag — true sources stream during the run
// (useRunTracker), false sources are fetched post-run (LiveRunTracker on save).
//
// Platform-exclusive methods resolve to null off their platform: settings.hrMethod
// is a *synced* preference, so an account configured on an Android phone can carry
// "healthconnect" onto an iPhone (and vice versa) — the method must degrade to
// off there, never reach a bridge that doesn't exist on this OS.
export function getHrSource(method: HrMethod | string | null | undefined) {
  if (method === "bluetooth" && (isAndroid || isIos)) return bleSource;
  if (method === "healthconnect" && isAndroid) return healthConnectSource;
  if (method === "healthkit" && isIos) return healthKitSource;
  return null;
}

// Selection options for the Settings UI on the current platform (label + whether
// each is currently usable is checked lazily by the UI via the source's
// isAvailable()). Bluetooth HR straps work on both platforms; the post-run health
// store differs (Health Connect vs Apple Health).
export function hrMethodsForPlatform(p: string = platform) {
  const methods = [
    { id: "off", label: "Off" },
    { id: "bluetooth", label: "Bluetooth sensor" },
  ];
  if (p === "android") methods.push({ id: "healthconnect", label: "Health Connect" });
  if (p === "ios") methods.push({ id: "healthkit", label: "Apple Health" });
  return methods;
}
