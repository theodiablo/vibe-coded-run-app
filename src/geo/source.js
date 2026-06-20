import { isNative } from "../native";
import { webSource } from "./web";
import { nativeSource } from "./native";

// The single geolocation source useRunTracker talks to. The native source is
// selected only inside the Capacitor shell; every browser gets the web source,
// so the pure web build is unaffected. Importing the native module is cheap —
// its Capacitor plugins are dynamic-imported inside its methods, which only run
// in the shell.
export const geoSource = isNative ? nativeSource : webSource;
