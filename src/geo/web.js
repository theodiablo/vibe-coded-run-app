// Web geolocation source — a thin wrapper over navigator.geolocation that keeps
// the Phase-1 behaviour byte-for-byte. The `background` option is accepted (so
// the interface matches the native source) but ignored: a browser cannot record
// with the screen off, which is exactly why the native shell exists.
//
// All four geolocation touch-points in useRunTracker go through this interface:
//   isAvailable() / watchPosition(onPos, onErr, opts) -> handle / clearWatch(handle)
// The position object handed to `onPos` is the native GeolocationPosition, whose
// shape (pos.coords.{latitude,longitude,altitude,accuracy}, pos.timestamp) the
// hook already reads — so nothing downstream changes.
export const webSource = {
  isAvailable: () => typeof navigator !== "undefined" && "geolocation" in navigator,

  // No-op on the web: the browser shows its own permission prompt the first time
  // watchPosition runs, so there's nothing to request up front.
  requestPermissions: async () => true,

  // Third arg (the shared `{ background }` option) is intentionally ignored — a
  // browser can't record in the background. Always high-accuracy, matching the
  // Phase-1 inline behaviour.
  watchPosition(onPos, onErr) {
    return navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 15000,
    });
  },

  clearWatch(handle) {
    if (handle != null) navigator.geolocation.clearWatch(handle);
  },
};
