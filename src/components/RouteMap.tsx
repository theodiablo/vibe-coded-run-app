import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import L, { type Circle, type Control, type LatLngExpression, type Map, type Marker, type Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_ATTRIBUTION, MAP_KEY, MAP_TILE_URL } from "../constants";
import { segments } from "../utils/geo";

// Imperative Leaflet wrapper. We drive the map directly via refs (no
// react-leaflet) so the polyline/marker update cheaply at GPS frequency without
// re-rendering React, and to avoid a React-version-coupled dependency.
//
// `points` is the tracker tuple array ([lat,lng,t,alt], null = gap). `follow`
// recenters on the latest fix while live.
export type TrackPoint = [number, number, number, number | null] | LatLngExpression;
type PreviewLocation = { lat: number; lng: number; acc?: number | null };
type RouteMapProps = {
  points?: (TrackPoint | null)[];
  follow?: boolean;
  interactive?: boolean;
  location?: PreviewLocation | null;
  className?: string;
  style?: CSSProperties;
};

type ToggleKey = "dragging" | "scrollWheelZoom" | "doubleClickZoom" | "boxZoom" | "keyboard" | "touchZoom" | "tap";

export function RouteMap({ points = [], follow = false, interactive = true, location = null, className = "", style }: RouteMapProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const linesRef = useRef<Polyline[]>([]);
  const dotRef = useRef<Marker | null>(null);
  const locDotRef = useRef<Marker | null>(null);     // preview position dot (before recording)
  const locCircleRef = useRef<Circle | null>(null);  // accuracy circle around the preview dot
  const locCenteredRef = useRef(false);
  const zoomCtrlRef = useRef<Control | null>(null);

  // Create the map once. Recreating it whenever interactivity changes would snap
  // the view back to the world map (it happened on every Start) — so interactive
  // is toggled in a separate effect below instead.
  useEffect(() => {
    if (!elRef.current) return;
    const map = L.map(elRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([0, 0], 2);
    L.tileLayer(MAP_TILE_URL, { attribution: MAP_ATTRIBUTION, maxZoom: 20 }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      linesRef.current = [];
      dotRef.current = null;
      locDotRef.current = null;
      locCircleRef.current = null;
      zoomCtrlRef.current = null;
      locCenteredRef.current = false;
    };
  }, []);

  // Enable/disable pan-zoom without tearing the map down (which would reset the
  // view). Tracking shows a non-interactive, auto-following map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (["dragging", "scrollWheelZoom", "doubleClickZoom", "boxZoom", "keyboard", "touchZoom", "tap"] as ToggleKey[])
      .forEach(h => map[h] && map[h][interactive ? "enable" : "disable"]());
    if (interactive && !zoomCtrlRef.current) {
      zoomCtrlRef.current = L.control.zoom();
      map.addControl(zoomCtrlRef.current);
    } else if (!interactive && zoomCtrlRef.current) {
      map.removeControl(zoomCtrlRef.current);
      zoomCtrlRef.current = null;
    }
  }, [interactive]);

  // Redraw the track whenever points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    linesRef.current.forEach(l => l.remove());
    linesRef.current = [];

    const segs = segments(points) as LatLngExpression[][];
    const all: LatLngExpression[] = [];
    let prevEnd: LatLngExpression | null = null;
    segs.forEach(seg => {
      if (!seg.length) return;
      // Bridge a gap (signal loss / suspended background) with a faded dashed line
      // so the route reads as one continuous run while still marking the stretch we
      // didn't actually track — distinct from the solid, recorded segments.
      if (prevEnd) {
        const bridge = L.polyline([prevEnd, seg[0]], {
          color: "#f97316", weight: 3, opacity: 0.5, dashArray: "4 8",
        }).addTo(map);
        linesRef.current.push(bridge);
      }
      const line = L.polyline(seg, { color: "#f97316", weight: 4, opacity: 0.9 }).addTo(map);
      linesRef.current.push(line);
      all.push(...seg);
      prevEnd = seg[seg.length - 1];
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

  // Preview the current location + an accuracy circle before recording starts
  // (i.e. while there are no track points yet) so the user can confirm a good
  // GPS lock and calibrate. Center once, then only move the dot/circle on later
  // fixes so panning to look around isn't fought.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (location && !points.length) {
      const ll: LatLngExpression = [location.lat, location.lng];
      const icon = L.divIcon({
        className: "",
        html: '<div style="width:14px;height:14px;border-radius:9999px;background:#60a5fa;border:2px solid #fff;box-shadow:0 0 0 2px rgba(96,165,250,.4)"></div>',
        iconSize: [14, 14], iconAnchor: [7, 7],
      });
      if (locDotRef.current) locDotRef.current.setLatLng(ll).setIcon(icon);
      else locDotRef.current = L.marker(ll, { icon, interactive: false }).addTo(map);

      if (location.acc != null) {
        if (locCircleRef.current) locCircleRef.current.setLatLng(ll).setRadius(location.acc);
        else locCircleRef.current = L.circle(ll, {
          radius: location.acc, color: "#60a5fa", weight: 1,
          fillColor: "#60a5fa", fillOpacity: 0.12, interactive: false,
        }).addTo(map);
      } else if (locCircleRef.current) {
        locCircleRef.current.remove();
        locCircleRef.current = null;
      }

      if (!locCenteredRef.current) {
        map.setView(ll, Math.max(map.getZoom(), 16), { animate: false });
        locCenteredRef.current = true;
      }
    } else {
      if (locDotRef.current) { locDotRef.current.remove(); locDotRef.current = null; }
      if (locCircleRef.current) { locCircleRef.current.remove(); locCircleRef.current = null; }
      locCenteredRef.current = false;
    }
  }, [location, points.length]);

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
