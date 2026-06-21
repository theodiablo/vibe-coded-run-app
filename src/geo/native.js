import { registerPlugin } from "@capacitor/core";

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
// The plugins are loaded lazily (dynamic import) so they never enter the web
// bundle's eager graph. The background plugin is addressed via registerPlugin by
// name — its native code is discovered by `cap sync`, so we don't depend on the
// package's JS export shape, only on it being installed.

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
      altitude: loc.altitude == null ? null : loc.altitude,
      accuracy: loc.accuracy == null ? null : loc.accuracy,
      altitudeAccuracy: loc.altitudeAccuracy == null ? null : loc.altitudeAccuracy,
      speed: loc.speed == null ? null : loc.speed,
      heading: loc.bearing == null ? null : loc.bearing,
    },
    timestamp: loc.time == null ? Date.now() : loc.time,
  };
}

export function adaptBgError(error) {
  const code = error && error.code === "NOT_AUTHORIZED" ? PERMISSION_DENIED : POSITION_UNAVAILABLE;
  return {
    code, message: (error && error.message) || "Location error",
    PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT,
  };
}

let _geoPlugin = null;
async function geoPlugin() {
  if (!_geoPlugin) _geoPlugin = (await import("@capacitor/geolocation")).Geolocation;
  return _geoPlugin;
}

// Explicitly request foreground (fine) location, reliably showing the OS dialog.
// Relying on addWatcher's own requestPermissions alone proved flaky (no prompt on
// some devices). Returns true if location is usable. Throws are swallowed by the
// caller, which then falls back to addWatcher's built-in request.
async function ensureForegroundPermission() {
  const Geolocation = await geoPlugin();
  let perm = await Geolocation.checkPermissions();
  const ok = (p) => p.location === "granted" || p.coarseLocation === "granted";
  if (!ok(perm)) perm = await Geolocation.requestPermissions({ permissions: ["location"] });
  return ok(perm);
}

export const nativeSource = {
  isAvailable: () => true,

  // Returns a sync handle immediately. The underlying watcher id resolves
  // asynchronously; `handle.removed` covers a clearWatch that races ahead of it.
  watchPosition(onPos, onErr, { background = false } = {}) {
    const handle = { id: null, removed: false, background };

    if (background) {
      (async () => {
        // Step 1: foreground/fine location — a guaranteed prompt. Step 2 below
        // (addWatcher requestPermissions) escalates to "Allow all the time" for
        // screen-off recording. This two-step order is the Android-correct flow.
        try {
          if (!(await ensureForegroundPermission())) {
            onErr?.(adaptBgError({ code: "NOT_AUTHORIZED", message: "Location permission denied" }));
            return;
          }
        } catch { /* plugin unavailable — let addWatcher request below */ }
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
      geoPlugin().then((Geolocation) =>
        Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 15000 }, (pos, err) => {
          if (err) { onErr?.(err); return; }
          if (pos) onPos(pos); // already a GeolocationPosition-shaped object
        }),
      ).then((id) => {
        if (handle.removed) geoPlugin().then((G) => G.clearWatch({ id }));
        else handle.id = id;
      }).catch((e) => onErr?.(e));
    }

    return handle;
  },

  clearWatch(handle) {
    if (!handle) return;
    handle.removed = true;
    if (handle.id == null) return; // not yet started; the resolver above will remove it
    if (handle.background) BackgroundGeolocation.removeWatcher({ id: handle.id });
    else geoPlugin().then((Geolocation) => Geolocation.clearWatch({ id: handle.id }));
  },
};
