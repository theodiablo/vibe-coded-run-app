import { isNative } from "../native";
import { WATCH_HC_AUTH_KEY, WATCH_SEEN_HC_IDS_KEY, WATCH_SEEN_MAX } from "../constants";
import { getWatchImportPlugin, type WatchImportAvailability } from "./plugin";
import { newWatchSessions } from "./mapping";
import type { Run } from "../types";

// Default rolling window scanned on each app open/foreground. No sync cursor:
// rescanning a fixed window (made idempotent by dedupe) naturally handles a watch
// that syncs to Health Connect hours or days after the run.
export const WATCH_SCAN_DAYS = 7;
// Wider window for the explicit "scan older runs" button in Settings. Health
// Connect refuses reads older than 30 days before the first grant anyway.
export const WATCH_MANUAL_SCAN_DAYS = 30;
// Ignore anything shorter than this — accidental start/stops, same threshold as
// the CSV import sanity filter.
export const WATCH_MIN_KM = 0.5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function hasWatchAuthorization(): boolean {
  try { return localStorage.getItem(WATCH_HC_AUTH_KEY) === "1"; }
  catch { return false; }
}

function setWatchAuthorization(ok: boolean) {
  try {
    if (ok) localStorage.setItem(WATCH_HC_AUTH_KEY, "1");
    else localStorage.removeItem(WATCH_HC_AUTH_KEY);
  } catch { /* storage unavailable — non-fatal */ }
}

// Health Connect session ids this device has already imported or dismissed.
// Per-device (an import is a local action) and capped so the list can't grow
// without bound. Survives the user deleting the imported run, so a deleted run
// is never re-offered.
export function getSeenIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_SEEN_HC_IDS_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

export function markSeen(ids: string[]) {
  if (!ids?.length) return;
  try {
    const seen = new Set(getSeenIds());
    const next = getSeenIds();
    for (const id of ids) {
      if (id && !seen.has(id)) { seen.add(id); next.push(id); }
    }
    // Keep the most recent WATCH_SEEN_MAX (drop oldest first).
    localStorage.setItem(WATCH_SEEN_HC_IDS_KEY, JSON.stringify(next.slice(-WATCH_SEEN_MAX)));
  } catch { /* storage unavailable — non-fatal */ }
}

// Raw availability: "Available" | "NotInstalled" | "NotSupported". Any throw
// (plugin absent, older device, web) → "NotSupported".
export async function availability(): Promise<WatchImportAvailability> {
  try { return (await getWatchImportPlugin().checkAvailability())?.availability || "NotSupported"; }
  catch { return "NotSupported"; }
}

async function isAvailable() { return (await availability()) === "Available"; }

// Non-prompting permission check; keeps the local marker in sync with the real
// grant (clears it if the user revoked access in Health Connect).
async function checkPermissions(): Promise<boolean> {
  try {
    const ok = !!(await getWatchImportPlugin().checkHealthPermissions())?.granted;
    setWatchAuthorization(ok);
    return ok;
  } catch { setWatchAuthorization(false); return false; }
}

// Prompt for exercise/distance/elevation/HR read access. Returns whether granted.
async function requestPermissions(): Promise<boolean> {
  try {
    const ok = !!(await getWatchImportPlugin().requestHealthPermissions())?.granted;
    setWatchAuthorization(ok);
    return ok;
  } catch { setWatchAuthorization(false); return false; }
}

type ScanOptions = { enabled?: boolean; allowNativeRead?: boolean; days?: number; now?: number };

// Read finished exercise sessions from Health Connect over the last `days`, map
// them to runs, and drop anything already logged. Never throws and returns [] on
// any failure, mirroring flushPendingHr's guard structure: it only touches the
// native bridge when enabled AND this device holds the local grant marker (a
// synced preference alone is not enough — Android grants are per-install).
export async function scanWatchSessions(
  runs: Run[],
  { enabled = true, allowNativeRead = true, days = WATCH_SCAN_DAYS, now = Date.now() }: ScanOptions = {},
): Promise<Partial<Run>[]> {
  if (!enabled || !allowNativeRead || !isNative || !hasWatchAuthorization()) return [];
  try {
    if (!(await isAvailable()) || !(await checkPermissions())) return [];
    const res = await getWatchImportPlugin().readExerciseSessions({
      startTime: new Date(now - days * DAY_MS).toISOString(),
      endTime: new Date(now).toISOString(),
    });
    return newWatchSessions(res?.sessions || [], runs || [], getSeenIds())
      .filter(r => (Number(r.km) || 0) >= WATCH_MIN_KM);
  } catch { return []; }
}

// Surface for the Settings UI (connect flow + status), mirroring healthConnectSource.
export const watchImportSource = {
  id: "watchimport" as const,
  availability,
  isAvailable,
  checkPermissions,
  requestPermissions,
};
