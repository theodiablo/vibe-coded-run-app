import type { Run } from "../types";
import type { TrackPointOrGap } from "../utils/geo";

// A run produced by an import provider: a partial Run plus optional *transient*
// route points (GPX/TCX traces). The caller persists points via saveRoute and
// strips the field before addRuns — providers never import routes.ts, so they
// stay pure and unit-testable.
export type ImportedRun = Partial<Run> & { points?: TrackPointOrGap[] };

export type ImportParseResult = { runs: ImportedRun[]; error?: string | null };

// One pluggable source of finished runs. Three kinds today:
//  - "healthconnect": native on-device store other watch apps write into
//    (Garmin Connect, Zepp, Samsung Health…) — scan-capable, connectable.
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
  kind: "healthconnect" | "file" | "cloud";
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
  // Scan-capable providers: return new (deduped) runs since `days` ago.
  scan?: (runs: Run[], opts?: { days?: number; now?: number }) => Promise<ImportedRun[]>;
  // File providers: parse one user-picked file into runs.
  parse?: (file: { name: string; text: string }) => ImportParseResult;
  // Short guidance copy for the UI (how to enable the source).
  help?: string;
  // File providers: the <input accept> extension list.
  fileAccept?: string;
};
