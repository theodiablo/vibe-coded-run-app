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

  // The browser handles its own permission prompt on watchPosition, so the idle
  // preview is always allowed and there's nothing to request up front.
  checkPermissions: async () => true,
  requestPermissions: async () => true,

  // Third arg (the shared `{ background }` option) is intentionally ignored — a
  // browser can't record in the background. Always high-accuracy, matching the
  // Phase-1 inline behaviour.
  watchPosition(onPos: PositionCallback, onErr?: PositionErrorCallback) {
    return navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 15000,
    });
  },

  clearWatch(handle: number | null | undefined) {
    if (handle != null) navigator.geolocation.clearWatch(handle);
  },

  // One-off coarse fix for "races near me" (Discover) — not a watcher. Resolves
  // { lat, lng }; rejects (browser prompt denied / unavailable) so the UI can
  // show its location-unavailable state. Needs a secure context (https/localhost).
  getCurrentPosition(): Promise<{ lat: number; lng: number }> {
    return new Promise((resolve, reject) => {
      if (!this.isAvailable()) { reject(new Error("Geolocation unavailable")); return; }
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        reject,
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 },
      );
    });
  },
};
