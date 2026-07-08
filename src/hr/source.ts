import { isNative } from "../native";
import { bleSource } from "./ble";
import { healthConnectSource } from "./healthconnect";

// Resolve the heart-rate source for a chosen method, or null for "off" / web /
// unknown. Mirrors geoSource (src/geo/source.ts): HR capture is native-only, so
// the web build always gets null and behaves exactly as before. Callers branch on
// the returned source's `live` flag — true sources stream during the run
// (useRunTracker), false sources are fetched post-run (LiveRunTracker on save).
export function getHrSource(method) {
  if (!isNative) return null;
  if (method === "bluetooth") return bleSource;
  if (method === "healthconnect") return healthConnectSource;
  return null;
}

// Selection options for the Settings UI (label + whether each is currently usable
// is checked lazily by the UI via the source's isAvailable()).
export const HR_METHODS = [
  { id: "off", label: "Off" },
  { id: "bluetooth", label: "Bluetooth sensor" },
  { id: "healthconnect", label: "Health Connect" },
];
