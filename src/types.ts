import type { PlanSessionInput } from "./utils/plan";

export type Intent = "race" | "fitness" | null;
export type HrMethod = "off" | "bluetooth" | "healthconnect";
export type RunType = "EASY" | "TEMPO" | "INTERVALS" | "LONG" | "RACE" | "WALK" | "OTHER";

export type HealthAck = { v?: string | number; at?: string } | null;

export type SettingsState = Record<string, unknown> & {
  raceDate: string;
  goalSec: string | number;
  distanceKm: string | number;
  raceElevation: number;
  name: string;
  age: number;
  maxHR: number;
  restHR: number;
  onboarded: boolean;
  onboardStep: number;
  intent: Intent;
  healthAck: HealthAck;
  hrMethod: HrMethod;
  hrOptOut: boolean;
  // Opt-in preference (synced) for importing finished runs from a watch via
  // Health Connect (Garmin etc.). Like hrMethod it's a *preference only* — the
  // per-device WATCH_HC_AUTH_KEY marker must also be present before the native
  // Health Connect bridge is touched on a given install.
  watchImport?: boolean;
  planSessions: PlanSessionInput[];
  targetEditionId?: string | null;
};

export type HrPending = { start: string | number; end: string | number; source: string };

export type Run = Record<string, unknown> & {
  id?: string;
  date: string;
  type?: RunType | string;
  km: number;
  durationSec?: number;
  hr?: number | null;
  hrMax?: number | null;
  elevation?: number | null;
  effort?: number | null;
  notes?: string;
  source?: string;
  routeId?: string;
  routeTmp?: string;
  routePending?: boolean;
  hrPending?: HrPending | null;
  // Health Connect exercise-session id this run was imported from (source:"watch").
  // Used to dedupe repeated scans idempotently.
  hcId?: string;
  // ISO start instant of the run, when known (GPS-tracked or watch-imported).
  // Powers time-overlap dedupe between phone-tracked and watch-imported runs.
  startedAt?: string;
  wNum?: number;
  sId?: string;
};

export type PlanSession = Record<string, unknown> & {
  id: string;
  date: string;
  type: RunType | string;
  desc: string;
  km: number | string;
  pace: number;
  done?: boolean;
  skipped?: boolean;
  runId?: string | null;
  editionId?: string | null;
};

export type PlanWeek = Record<string, unknown> & {
  weekNumber: number;
  startDate?: string;
  phase?: string;
  sessions: PlanSession[];
};

export type Plan = Record<string, unknown> & {
  raceDate?: unknown;
  goalSec?: unknown;
  distanceKm?: unknown;
  raceElevation?: number;
  targetPace?: number;
  racePace?: number;
  longRunPeakKm?: number;
  planSessions?: PlanSessionInput[];
  weeks: PlanWeek[];
};

export type PlanPrefill = {
  raceDate: string;
  distanceKm: number;
  raceElevation: number;
  editionId: string;
  label: string;
};

export type RunPatch = Partial<Run>;
export type PlanProgress = Pick<PlanSession, "done" | "skipped" | "runId">;

export type RouteBackup = Record<string, unknown>;
export type UserContextState = { notes: string; lastLimitNoticeAt?: string | null };

export type ParticipationStatus = "wishlist" | "done" | "skipped" | string;

export type Participation = Record<string, unknown> & {
  editionId?: string | null;
  raceId?: string | null;
  label?: string;
  raceDate?: string;
  distanceKm?: number;
  status?: ParticipationStatus;
  inPlan?: boolean;
  timeSec?: number | null;
  runId?: string | null;
  source?: string;
  notes?: string;
};

export type RacesState = Record<string, unknown> & {
  participations: Participation[];
  seenBadges: string[] | null;
  ackVerified?: string[];
};

export type CatalogueEdition = Record<string, unknown> & {
  id: string;
  date: string;
  distanceKm: number;
  elevation?: number;
  createdBy?: string | null;
  verified?: boolean;
};

export type CatalogueRace = Record<string, unknown> & {
  id: string;
  slug?: string;
  name: string;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  distances?: number[];
  url?: string | null;
  createdBy?: string | null;
  verified?: boolean;
  editions: CatalogueEdition[];
};

export type JoinedEdition = CatalogueRace & {
  raceId: string;
  edition: CatalogueEdition;
};

export type RaceCandidate = { editionId?: string | null; date?: string; distanceKm?: string | number };

export type ToastAction = { label: string; onClick: () => void };
export type ToastState = { msg: string; type: string; action?: ToastAction };
