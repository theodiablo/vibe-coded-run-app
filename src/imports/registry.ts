import { healthConnectProvider } from "./providers/healthConnect";
import { fileProvider } from "./providers/file";
import { garminCloudProvider } from "./providers/cloud";
import { getSeenIds } from "../watch/import";
import { isDuplicateRun } from "./dedupe";
import type { ImportProvider, ImportedRun } from "./types";
import type { Run } from "../types";

// Every import integration the app knows about. Adding one = implement
// ImportProvider (see types.ts) and list it here — scanning, dedupe, the
// Integrations settings panel and the file picker all pick it up from this list.
export const importProviders: ImportProvider[] = [
  healthConnectProvider,
  fileProvider,
  garminCloudProvider, // scaffold: isAvailable() is false until actually wired
];

export const getProvider = (id: string) => importProviders.find(p => p.id === id) || null;

// Connectable integrations to show in Settings (file import lives in LogView —
// picking a file isn't a "connection").
export async function connectableProviders(): Promise<ImportProvider[]> {
  const out: ImportProvider[] = [];
  for (const p of importProviders) {
    if (p.connect && (await p.isAvailable())) out.push(p);
  }
  return out;
}

type ScanAllOptions = {
  days?: number;
  now?: number;
  // Caller-supplied preference gate (e.g. settings.watchImport for the Health
  // Connect provider). Providers themselves only check device-local state.
  enabled?: (p: ImportProvider) => boolean;
};

// Run every scan-capable, available, enabled provider and return the merged,
// deduped list of new runs. Sequential on purpose: each provider scans against
// the stored runs PLUS what earlier providers already produced, and every
// candidate passes isDuplicateRun against that same accumulating set — so the
// same run arriving from two sources collapses to one. Never throws; a failing
// provider contributes nothing.
export async function scanAllProviders(runs: Run[], opts: ScanAllOptions = {}): Promise<ImportedRun[]> {
  const found: ImportedRun[] = [];
  const seenIds = getSeenIds();
  for (const p of importProviders) {
    if (!p.scan) continue;
    try {
      if (!(await p.isAvailable())) continue;
      if (opts.enabled && !opts.enabled(p)) continue;
      const candidates = await p.scan((runs || []).concat(found as Run[]), { days: opts.days, now: opts.now });
      for (const cand of candidates || []) {
        // Recompute per candidate so a batch also dedupes against itself.
        if (!isDuplicateRun(cand, (runs || []).concat(found as Run[]), seenIds)) found.push(cand);
      }
    } catch { /* provider failed — skip it, others still run */ }
  }
  return found;
}
