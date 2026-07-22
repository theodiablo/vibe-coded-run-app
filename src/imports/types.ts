import type { Run } from "../types";
import type { TrackPointOrGap } from "../utils/geo";
import type { HrSample } from "./series";

// A run produced by an import provider: a partial Run plus optional *transient*
// route points (GPX/TCX traces) and/or a raw HR series (health-store imports —
// HealthKit's HKWorkoutRoute + per-sample HR, Health Connect's HeartRateRecord).
// The caller (persistImportedRoute) persists both into a run_routes row and
// strips the fields before addRuns — providers never import routes.ts, so they
// stay pure and unit-testable. A run with points → routeId; HR series with no
// points → hrRouteId (see persistImportedRoute).
export type ImportedRun = Partial<Run> & { points?: TrackPointOrGap[]; hrSamples?: HrSample[] };

export type ImportParseResult = { runs: ImportedRun[]; error?: string | null };

// One pluggable source of finished runs. Four kinds today:
//  - "healthconnect": Android's on-device store other watch apps write into
//    (Garmin Connect, Zepp, Samsung Health…) — scan-capable, connectable.
//  - "healthkit": the iOS equivalent (Apple Health) — same shape, iOS-only.
//  - "file": user-picked activity exports (CSV/GPX/TCX) — parse-capable,
//    works on web too, never scanned automatically.
//  - "cloud": vendor cloud APIs (OAuth + server-side webhook/poll). Scaffold
//    only for now — see providers/cloud.ts.
//
// Adding an integration = implementing this interface and registering it in
// registry.ts. The dedupe (src/imports/dedupe.ts isDuplicateRun) and the save
// pipeline (toast → goLog review / addRuns batch, race detect, plan auto-tick)
// are provider-agnostic and need no changes.
export type ImportProvider = {
  id: string;
  label: string;
  kind: "healthconnect" | "healthkit" | "file" | "cloud";
  platform: "native" | "web" | "both";
  // Can this provider work here at all (right platform, plugin present,
  // config set)? Unavailable providers are skipped by scans and hidden by the UI.
  isAvailable: () => Promise<boolean> | boolean;
  // Is this device currently authorized/connected? (Per-device, like the HC
  // grant markers — a synced preference alone is never enough.)
  isConnected?: () => Promise<boolean> | boolean;
  // Prompt the user to authorize; returns whether it was granted.
  connect?: () => Promise<boolean>;
  disconnect?: () => void;
  // Scan-capable providers: return new (deduped) runs since `days` ago. `trigger`
  // is a free-form label ("auto"/"manual") for diagnostics only.
  scan?: (runs: Run[], opts?: { days?: number; now?: number; trigger?: string }) => Promise<ImportedRun[]>;
  // File providers: parse one user-picked file into runs. Text-based formats
  // (CSV/GPX/TCX) read `text`; binary formats (FIT) read `bytes` — the caller
  // decides which to populate from the extension (see LogView.handleFile).
  parse?: (file: { name: string; text: string; bytes?: Uint8Array }) => ImportParseResult;
  // Short guidance copy for the UI (how to enable the source).
  help?: string;
  // File providers: the <input accept> extension list.
  fileAccept?: string;
};
