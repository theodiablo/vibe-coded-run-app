import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_ATTRIBUTION, MAP_KEY, MAP_TILE_URL } from "../constants";
import { segments } from "../utils/geo";

// Imperative Leaflet wrapper. We drive the map directly via refs (no
// react-leaflet) so the polyline/marker update cheaply at GPS frequency without
// re-rendering React, and to avoid a React-version-coupled dependency.
//
// `points` is the tracker tuple array ([lat,lng,t,alt], null = gap). `follow`
// recenters on the latest fix while live.
export function RouteMap({ points = [], follow = false, interactive = true, className = "", style }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const linesRef = useRef([]);
  const dotRef = useRef(null);

  // Create the map once.
  useEffect(() => {
    const map = L.map(elRef.current, {
      zoomControl: interactive,
      attributionControl: true,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      tap: interactive,
    }).setView([0, 0], 2);
    L.tileLayer(MAP_TILE_URL, { attribution: MAP_ATTRIBUTION, maxZoom: 20 }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [interactive]);

  // Redraw the track whenever points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    linesRef.current.forEach(l => l.remove());
    linesRef.current = [];

    const segs = segments(points);
    const all = [];
    segs.forEach(seg => {
      if (seg.length) {
        const line = L.polyline(seg, { color: "#f97316", weight: 4, opacity: 0.9 }).addTo(map);
        linesRef.current.push(line);
        all.push(...seg);
      }
    });

    // Current-position dot (CSS divIcon — no external marker image, so no CSP
    // or bundler icon-path issues).
    const lastSeg = segs[segs.length - 1];
    const head = lastSeg && lastSeg[lastSeg.length - 1];
    if (head) {
      const icon = L.divIcon({
        className: "",
        html: '<div style="width:14px;height:14px;border-radius:9999px;background:#f97316;border:2px solid #fff;box-shadow:0 0 0 2px rgba(249,115,22,.4)"></div>',
        iconSize: [14, 14], iconAnchor: [7, 7],
      });
      if (dotRef.current) dotRef.current.setLatLng(head).setIcon(icon);
      else dotRef.current = L.marker(head, { icon, interactive: false }).addTo(map);
    } else if (dotRef.current) {
      dotRef.current.remove();
      dotRef.current = null;
    }

    if (follow && head) {
      map.setView(head, Math.max(map.getZoom(), 16), { animate: false });
    } else if (all.length) {
      map.fitBounds(L.latLngBounds(all).pad(0.15), { animate: false });
    }
  }, [points, follow]);

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      <div ref={elRef} style={{ position: "absolute", inset: 0 }} />
      {!MAP_KEY && (
        <div className="absolute bottom-1 left-1 right-1 z-[400] text-[10px] text-amber-300 bg-slate-900/80 rounded px-1.5 py-0.5 pointer-events-none">
          Map tiles need VITE_MAPTILER_KEY — route still records.
        </div>
      )}
    </div>
  );
}
