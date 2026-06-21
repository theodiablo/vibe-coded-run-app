import { isNative } from "../native";
import { webSource } from "./web";
import { nativeSource } from "./native";

// The single geolocation source useRunTracker talks to. The native source is
// selected only inside the Capacitor shell; every browser gets the web source,
// so the pure web build is unaffected. native.js statically imports its Capacitor
// plugins (a dynamic import can fail to load in the WebView), but they're never
// *used* on the web — webSource is selected and the native methods never run.
export const geoSource = isNative ? nativeSource : webSource;
