import { registerPlugin } from "@capacitor/core";
import { isAndroid } from "../native";
import { BG_LOC_ASKED_KEY } from "../constants";
import { logTrack } from "./trackLog";

// Request ACCESS_BACKGROUND_LOCATION ("Allow all the time") so live run tracking
// keeps receiving GPS fixes with the screen off / app backgrounded, rather than
// relying solely on the foreground service — which in practice stalls on this
// device once the WebView is frozen (long screen-off holes in the recorded track).
//
// Deliberately scoped to builds that DECLARE the permission in their manifest —
// the debug / personal sideload build, via android/app/src/debug/AndroidManifest.xml.
// The public Play release does NOT declare it (so no Google Play background-location
// review), and on that build the native side reports declared:false and this is a
// no-op — the app stays foreground-only exactly as before. Backed by the local
// RunPermissions plugin (the same one that owns POST_NOTIFICATIONS). Android-only,
// never throws, never blocks recording.

type RunPermissionsBg = {
  checkBackgroundLocation: () => Promise<{ granted?: boolean; declared?: boolean }>;
  requestBackgroundLocation: () => Promise<{ granted?: boolean; declared?: boolean }>;
};

let cached: RunPermissionsBg | null = null;
function plugin(): RunPermissionsBg {
  if (!cached) cached = registerPlugin<RunPermissionsBg>("RunPermissions");
  return cached;
}

const markAsked = () => {
  try { localStorage.setItem(BG_LOC_ASKED_KEY, "1"); } catch { /* non-fatal */ }
};

// True only on a build whose manifest declares ACCESS_BACKGROUND_LOCATION — i.e.
// the debug/personal build, where the "Allow all the time" step actually happens.
// The disclosure uses this to decide whether to show the extra step-by-step prompt
// guidance; on the release build (and web) it's false, so that copy never appears
// and the disclosure keeps its Play-compliant "While using the app" wording.
export async function isBackgroundLocationAvailable(): Promise<boolean> {
  if (!isAndroid) return false;
  try { return !!(await plugin().checkBackgroundLocation())?.declared; }
  catch { return false; }
}

// Ask for background location at most once per install. On Android 11+ the OS
// routes this to a Settings screen (there is no in-context "Allow all the time"
// dialog), so re-asking on every run would be a nag — hence the once flag. Must be
// called only AFTER foreground fine location is granted (the caller guarantees it),
// which is the OS precondition for the background request to be offered at all.
export async function ensureBackgroundLocationOnce(): Promise<void> {
  if (!isAndroid) return;
  let asked = false;
  try { asked = localStorage.getItem(BG_LOC_ASKED_KEY) === "1"; } catch { /* storage unavailable */ }
  if (asked) return;
  try {
    const status = await plugin().checkBackgroundLocation();
    if (!status?.declared) return;                       // release build — not in the manifest; stay foreground-only
    if (status.granted) { logTrack("perm", { ok: true, msg: "bg-already" }); markAsked(); return; }
    const res = await plugin().requestBackgroundLocation();
    logTrack("perm", { ok: !!res?.granted, msg: "bg" });
    markAsked();
  } catch { /* plugin missing / web proxy rejected — non-fatal, stay foreground-only */ }
}
