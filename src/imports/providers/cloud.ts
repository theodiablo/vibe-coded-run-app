import type { ImportProvider, ImportedRun } from "../types";
import type { Run } from "../../types";

// Cloud-provider scaffold — code-level interface only, NOT a user-visible
// feature. A real vendor-cloud integration (e.g. the Garmin Connect Activity
// API, if their developer program reopens) needs:
//  - OAuth with the client secret held SERVER-SIDE in a Supabase edge function
//    (mirror coach-agent / notify-contribution — a secret can never ship in the
//    SPA bundle), which also receives the vendor's activity webhooks;
//  - this provider then just scan()s our own backend for landed activities and
//    maps them to runs stamped with `extId` (the vendor activity id) so the
//    registry's dedupe treats them like any other source.
//
// Until then every instance is unconfigured: isAvailable() is false, so the UI
// never renders a row (no "coming soon" placeholders — that would imply a
// vendor partnership that doesn't exist and Play discourages stub features).
//
// Strava is deliberately NOT planned as a cloud provider: its API agreement
// bans using API data in AI models, and the coach agent reads runs from
// app_state. Users can still import their own Strava CSV/GPX exports (file
// provider) — that's their data-portability copy, not the API.
export type CloudProviderConfig = {
  id: string;
  label: string;
  // Set when the integration is actually wired (server function deployed and a
  // client id configured, e.g. via a VITE_* env). Absent → provider disabled.
  clientId?: string;
  connect?: () => Promise<boolean>;
  scan?: (runs: Run[], opts?: { days?: number; now?: number }) => Promise<ImportedRun[]>;
};

export function makeCloudProvider(config: CloudProviderConfig): ImportProvider {
  const enabled = !!config.clientId;
  return {
    id: config.id,
    label: config.label,
    kind: "cloud",
    platform: "both",
    isAvailable: () => enabled,
    isConnected: () => false,
    connect: async () => {
      if (!enabled || !config.connect) return false;
      return config.connect();
    },
    scan: async (runs, opts) => {
      if (!enabled || !config.scan) return []; // not enabled — silently contributes nothing
      return config.scan(runs, opts);
    },
  };
}

// Example registration proving the wiring end-to-end while staying invisible
// (no VITE_GARMIN_CLIENT_ID exists, so isAvailable() is false everywhere).
export const garminCloudProvider = makeCloudProvider({
  id: "garmin",
  label: "Garmin Connect",
  clientId: import.meta.env?.VITE_GARMIN_CLIENT_ID,
});
