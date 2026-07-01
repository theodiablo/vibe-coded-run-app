import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader, MapPin, X } from "lucide-react";
import { MAP_ATTRIBUTION, MAP_KEY, MAP_TILE_URL } from "../constants";
import { geoSource } from "../geo/source";
import { geocodePlace } from "../utils/geocode";

const WORLD_CENTER = [20, 0];
const WORLD_ZOOM = 2;
const PICKED_ZOOM = 13;

// Full-screen tap/drag map picker for a single point. Built for "Add a race":
// a contributor is rarely standing where the race actually happens, so a
// "use my current location" button alone produces wrong coordinates for the
// shared catalogue. This lets them place a pin directly instead — opening
// centered on `initial` (an already-set location) or a one-off geocode of
// `geocodeQuery` (the city/country they already typed), falling back to the
// world view. "Jump to my current location" is offered too, but only as one
// more way to seed the pin, never the only option.
export function LocationPicker({ initial, geocodeQuery, onConfirm, onCancel }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [picked, setPicked] = useState(initial || null);
  const [locating, setLocating] = useState(false);

  const placeMarker = (lat, lng) => {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
    else {
      markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(map);
      markerRef.current.on("dragend", () => {
        const ll = markerRef.current.getLatLng();
        setPicked({ lat: ll.lat, lng: ll.lng });
      });
    }
    setPicked({ lat, lng });
  };

  useEffect(() => {
    const map = L.map(elRef.current, { zoomControl: true }).setView(
      initial ? [initial.lat, initial.lng] : WORLD_CENTER,
      initial ? PICKED_ZOOM : WORLD_ZOOM,
    );
    L.tileLayer(MAP_TILE_URL, { attribution: MAP_ATTRIBUTION, maxZoom: 20 }).addTo(map);
    map.on("click", (e) => placeMarker(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    if (initial) placeMarker(initial.lat, initial.lng);
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Map is created once; initial only seeds the opening view/pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter (but don't place a pin) once the city/country the contributor
  // already typed resolves to coordinates — skipped if they've already set an
  // explicit location, so re-opening the picker never fights their edit.
  useEffect(() => {
    if (initial || !geocodeQuery?.trim()) return;
    let cancelled = false;
    geocodePlace(geocodeQuery).then((center) => {
      if (!cancelled && center && mapRef.current) {
        mapRef.current.setView([center.lat, center.lng], PICKED_ZOOM, { animate: false });
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const p = await geoSource.getCurrentPosition();
      mapRef.current?.setView([p.lat, p.lng], PICKED_ZOOM, { animate: false });
      placeMarker(p.lat, p.lng);
    } catch { /* the map itself is the fallback — no need to surface this */ }
    finally { setLocating(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900 z-[2000] flex flex-col">
      <header className="flex items-center justify-between px-4 border-b border-slate-800 shrink-0" style={{ height: 44 }}>
        <p className="text-sm font-semibold">Set race location</p>
        <button onClick={onCancel} aria-label="Close" className="text-slate-400 hover:text-white p-1.5"><X size={18} /></button>
      </header>
      <p className="text-[12px] text-slate-400 px-4 py-2 shrink-0">
        Tap or drag the pin onto where the race actually starts — not necessarily where you are right now.
      </p>
      <div className="flex-1 min-h-0 relative">
        <div ref={elRef} className="absolute inset-0" />
        {!MAP_KEY && (
          <div className="absolute bottom-2 left-2 right-2 z-[400] text-[10px] text-amber-300 bg-slate-900/80 rounded px-1.5 py-0.5 pointer-events-none">
            Map tiles need VITE_MAPTILER_KEY — you can still tap to set coordinates.
          </div>
        )}
      </div>
      <div className="p-4 space-y-2 border-t border-slate-800 shrink-0">
        <button onClick={useMyLocation} disabled={locating}
          className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60">
          {locating ? <Loader size={14} className="animate-spin" /> : <MapPin size={14} />}
          Jump to my current location
        </button>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2.5 rounded-xl text-sm font-semibold transition-colors">
            Cancel
          </button>
          <button onClick={() => picked && onConfirm(picked)} disabled={!picked}
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
