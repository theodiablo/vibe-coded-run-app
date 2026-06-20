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

  watchPosition(onPos, onErr, { highAccuracy = true } = {}) {
    return navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: highAccuracy, maximumAge: 0, timeout: 15000,
    });
  },

  clearWatch(handle) {
    if (handle != null) navigator.geolocation.clearWatch(handle);
  },
};
