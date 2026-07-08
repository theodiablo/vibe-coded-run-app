// @ts-nocheck
import { registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

// Native geolocation source for the Capacitor shell. It exposes the SAME
// interface as the web source (isAvailable / watchPosition / clearWatch) so
// useRunTracker never branches on platform — only the source it imports differs.
//
// Two paths, keyed on opts.background:
//   • background:false (idle preview) → @capacitor/geolocation, foreground only,
//     NO foreground service / notification (it would be wrong to show a
//     "recording" notification while the user is still on the start screen).
//   • background:true (Start/Resume)  → @capacitor-community/background-geolocation
//     addWatcher, which runs an Android foreground service + persistent
//     notification so fixes keep coming with the screen off / app backgrounded.
//
// @capacitor/geolocation is imported STATICALLY (not lazily): a dynamic import
// can fail to load its chunk inside the WebView, which previously left the
// permission request silently broken. The background plugin is addressed via
// registerPlugin by name — its native code is discovered by `cap sync`, so we
// don't depend on the package's JS export shape, only on it being installed.

const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");

// GeolocationPositionError-style codes, so the existing onErr in useRunTracker
// (which reads `err.code === err.PERMISSION_DENIED`) works unchanged.
const PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3;

// Normalize a background-geolocation `location` into the GeolocationPosition
// shape that onPos already consumes (coords.{latitude,longitude,altitude,
// accuracy} + timestamp). Exported pure so it can be unit-tested.
export function adaptBgLocation(loc) {
  return {
    coords: {
      latitude: loc.latitude,
      longitude: loc.longitude,
      altitude: loc.altitude ?? null,
      accuracy: loc.accuracy ?? null,
      altitudeAccuracy: loc.altitudeAccuracy ?? null,
      speed: loc.speed ?? null,
      heading: loc.bearing ?? null, // plugin's `bearing` → GeolocationCoordinates `heading`
    },
    timestamp: loc.time ?? Date.now(),
  };
}

export function adaptBgError(error) {
  const code = error && error.code === "NOT_AUTHORIZED" ? PERMISSION_DENIED : POSITION_UNAVAILABLE;
  return {
    code, message: (error && error.message) || "Location error",
    PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT,
  };
}

// True if a Geolocation permission status grants fine or coarse location.
const isGranted = (p) => !!p && (p.location === "granted" || p.coarseLocation === "granted");

// Request foreground (fine) location, reliably showing the OS dialog(s). Returns
// true if location is usable; never throws (fast to check below).
//
// checkPermissions()/requestPermissions() are the plugin's OWN gate on Android:
// they check whether the device's system Location Services are switched on FIRST,
// and REJECT immediately if not — before ever showing the OS permission dialog.
// That's exactly the "no prompt at all" bug users hit with location off: relying
// on requestPermissions() alone as the ask means we dead-end with a rejected
// promise and never show anything. getCurrentPosition() has no such gate — it
// requests the runtime permission itself, then (via Google Play Services)
// surfaces the system "turn on device location" dialog if needed. So use it as
// the real ask whenever the fast-path check doesn't already confirm we're good.
export async function ensureForegroundPermission() {
  try {
    if (isGranted(await Geolocation.checkPermissions())) return true;
  } catch { /* location services likely off — fall through to the real ask below */ }
  try {
    await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

export const nativeSource = {
  isAvailable: () => true,

  // Non-prompting check — true if location is already granted. Lets the idle
  // preview show for returning users without firing an out-of-context dialog.
  async checkPermissions() {
    return isGranted(await Geolocation.checkPermissions());
  },

  // Request foreground location, showing the OS dialog. Called from the consent
  // flow so the prompt appears right after the user accepts the disclosure — not
  // only when recording starts. Returns true if usable; may reject (caller wraps).
  requestPermissions: () => ensureForegroundPermission(),

  // Returns a sync handle immediately. The underlying watcher id resolves
  // asynchronously; `handle.removed` covers a clearWatch that races ahead of it.
  watchPosition(onPos, onErr, { background = false } = {}) {
    const handle = { id: null, removed: false, background };

    if (background) {
      (async () => {
        // Step 1: foreground/fine location — a guaranteed OS prompt. Step 2
        // (addWatcher requestPermissions) escalates to "Allow all the time" for
        // screen-off recording. This two-step order is the Android-correct flow.
        let granted;
        try {
          granted = await ensureForegroundPermission();
        } catch (e) {
          onErr?.(adaptBgError(e)); // surface — do not hide a broken prompt
          return;
        }
        if (!granted) {
          onErr?.(adaptBgError({ code: "NOT_AUTHORIZED", message: "Location permission was not granted." }));
          return;
        }
        if (handle.removed) return;
        try {
          const id = await BackgroundGeolocation.addWatcher(
            {
              requestPermissions: true,
              stale: false,
              distanceFilter: 5,
              backgroundTitle: "Recording run",
              backgroundMessage: "Tap to return to Running Coach",
            },
            (location, error) => {
              if (error) { onErr?.(adaptBgError(error)); return; }
              if (location) onPos(adaptBgLocation(location));
            },
          );
          if (handle.removed) BackgroundGeolocation.removeWatcher({ id });
          else handle.id = id;
        } catch (e) {
          onErr?.(adaptBgError(e));
        }
      })();
    } else {
      Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 15000 }, (pos, err) => {
        if (err) { onErr?.(adaptBgError(err)); return; }
        if (pos) onPos(pos); // already a GeolocationPosition-shaped object
      }).then((id) => {
        if (handle.removed) Geolocation.clearWatch({ id });
        else handle.id = id;
      }).catch((e) => onErr?.(adaptBgError(e)));
    }

    return handle;
  },

  clearWatch(handle) {
    if (!handle) return;
    handle.removed = true;
    if (handle.id == null) return; // not yet started; the resolver above will remove it
    if (handle.background) BackgroundGeolocation.removeWatcher({ id: handle.id });
    else Geolocation.clearWatch({ id: handle.id });
  },

  // One-off coarse fix for "races near me" (Discover). Ensures foreground
  // permission (showing the OS dialog if needed), then a single getCurrentPosition.
  // Resolves { lat, lng }; rejects on denial/unavailable so the UI can react.
  async getCurrentPosition() {
    if (!(await ensureForegroundPermission())) throw new Error("Location permission was not granted.");
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000 });
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  },
};
