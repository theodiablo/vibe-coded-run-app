import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { RouteMap } from "../components/RouteMap";
import { useDismissable } from "../hooks/useDismissable";
import { useRouteTrace } from "../hooks/useRouteTrace";
import { buildRunSeries } from "../utils/runSeries";
import { buildSplits } from "../utils/runSplits";
import { timeInZones, effectiveMaxHR, HR_ZONES } from "../utils/hr";
import { fmt } from "../utils/format";
import type { HrSample, RunSeriesRow } from "../utils/runSeries";
import type { TrackPointOrGap } from "../utils/geo";
import type { Run, SettingsState } from "../types";

type Props = { run: Run; settings: SettingsState; onClose: () => void };

const ELEV_CLR = "#10b981", PACE_CLR = "#38bdf8", HR_CLR = "#f87171";
const tt = { background: "#1e293b", border: "none", borderRadius: 8, color: "#fff", fontSize: 12 };

// One toggle chip for a chart series.
function Chip({ on, color, label, onToggle }: { on: boolean; color: string; label: string; onToggle: () => void }) {
  return (
    <button aria-pressed={on} onClick={onToggle}
      className={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors " + (on ? "bg-slate-700 text-white" : "text-slate-500")}>
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: on ? color : "#475569" }} />
      {label}
    </button>
  );
}

// The combined elevation / pace / HR chart. Extracted + exported so a render
// test can guard the two recharts traps directly: the numeric distance x-axis
// (a categorical axis would evenly space unevenly-spaced post-simplify points)
// and the distinct per-series `yAxisId`s (recharts throws if a series references
// a yAxisId with no matching YAxis).
export function RunChart({ series, show, hasElev, hasHr }: {
  series: RunSeriesRow[];
  show: { elev: boolean; pace: boolean; hr: boolean };
  hasElev: boolean;
  hasHr: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={series} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" />
        {/* Numeric distance axis: post-simplify points are unevenly spaced in km,
            so a categorical axis would misplace where things happened. */}
        <XAxis dataKey="distKm" type="number" domain={[0, "dataMax"]} allowDecimals={false}
          tick={{ fill: "#475569", fontSize: 10 }} tickFormatter={(v: number) => String(Math.round(v))} />
        {/* Each series pins its OWN yAxisId — recharts silently collapses to a
            single axis if a series' yAxisId is missing. */}
        <YAxis yAxisId="elev" hide domain={["dataMin - 10", "dataMax + 10"]} />
        <YAxis yAxisId="pace" hide reversed domain={["dataMin - 20", "dataMax + 20"]} />
        <YAxis yAxisId="hr" hide domain={["dataMin - 5", "dataMax + 5"]} />
        <Tooltip contentStyle={tt}
          labelFormatter={(v) => t("progress.detail.tooltip.km", { v: Number(v).toFixed(2) })}
          formatter={(value, name) => {
            if (value == null) return ["", ""];
            if (name === "paceSecPerKm") return [t("progress.detail.tooltip.pace", { pace: fmt.pace(Number(value)) }), t("progress.detail.series.pace")];
            if (name === "elevM") return [t("progress.detail.tooltip.elevation", { v: Math.round(Number(value)) }), t("progress.detail.series.elevation")];
            if (name === "hr") return [t("progress.detail.tooltip.hr", { bpm: Math.round(Number(value)) }), t("progress.detail.series.heartRate")];
            return [String(value), String(name)];
          }} />
        {hasElev && show.elev &&
          <Area yAxisId="elev" type="monotone" dataKey="elevM" stroke={ELEV_CLR} fill={ELEV_CLR} fillOpacity={0.15} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />}
        {show.pace &&
          <Line yAxisId="pace" type="monotone" dataKey="paceSecPerKm" stroke={PACE_CLR} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />}
        {hasHr && show.hr &&
          <Line yAxisId="hr" type="monotone" dataKey="hr" stroke={HR_CLR} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <p className="text-slate-400 text-xs">{label}</p>
      <p className="text-white text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

// Full-screen per-run analytics: route map, a combined elevation/pace/HR chart
// with toggleable series, a per-km split table, an HR time-in-zone card (BLE runs
// only), and summary tiles. Self-fetches the trace (kept out of the synced blob).
export function RunDetailModal({ run, settings, onClose }: Props) {
  const { t } = useTranslation();
  const { route } = useRouteTrace(run, { withStats: true });
  const [show, setShow] = useState({ elev: true, pace: true, hr: true });
  useDismissable(true, onClose);

  const hasTrace = !!(run.routeId || run.routeTmp);
  const maxHR = effectiveMaxHR(settings);
  const restHR = settings.restHR || 60; // match every other zone call site's fallback

  // Derive all chart/table data once per trace change — NOT on every re-render.
  // The modal re-renders on any hub state change (toasts, background scans) and on
  // each toggle-chip click, and these scans are O(points)+O(HR samples); a
  // multi-hour run has thousands of each.
  const derived = useMemo(() => {
    const points = (route?.points ?? []) as unknown as TrackPointOrGap[];
    const hrSamples = (route?.stats?.hrSamples as HrSample[] | undefined) || null;
    const series = points.length ? buildRunSeries(points, hrSamples) : [];
    return {
      hasPoints: points.length > 0,
      series,
      splits: points.length ? buildSplits(points, hrSamples) : [],
      zones: timeInZones(hrSamples, maxHR, restHR),
      // HR presence is the RAW stream, not per-point alignment — so the chart HR
      // series and the time-in-zone card agree (a sparse GPS trace could otherwise
      // hide the chart line while the zone card still rendered).
      hasHr: !!(hrSamples && hrSamples.length),
      hasElev: series.some(r => r.elevM != null),
    };
  }, [route, maxHR, restHR]);
  const { hasPoints, series, splits, zones, hasHr, hasElev } = derived;
  const zoneTotal = zones.reduce((s, z) => s + z.sec, 0);

  const pace = run.km && run.durationSec ? run.durationSec / run.km : 0;

  const header = (
    <header className="flex items-center justify-between px-4 border-b border-slate-800 shrink-0"
      style={{ height: "calc(44px + var(--safe-top))", paddingTop: "var(--safe-top)" }}>
      <div className="min-w-0">
        <p className="text-white text-sm font-semibold truncate">{fmt.date(run.date)}</p>
        <p className="text-slate-400 text-xs">{run.km + " km · " + fmt.dur(run.durationSec)}</p>
      </div>
      <button onClick={onClose} aria-label={t("common.close")}
        className="flex items-center justify-center text-slate-400 hover:text-white p-1.5 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors">
        <X size={18} />
      </button>
    </header>
  );

  const tiles = (
    <div className="grid grid-cols-2 gap-3">
      <Tile label={t("progress.detail.tiles.distance")} value={run.km + " km"} />
      <Tile label={t("progress.detail.tiles.duration")} value={fmt.dur(run.durationSec)} />
      <Tile label={t("progress.detail.tiles.avgPace")} value={fmt.pace(pace) + "/km"} />
      {!!run.elevation && <Tile label={t("progress.detail.tiles.elevation")} value={run.elevation + " m"} />}
      {!!run.hr && <Tile label={t("progress.detail.tiles.avgHr")} value={t("progress.detail.tooltip.hr", { bpm: run.hr })} />}
      {!!run.hrMax && <Tile label={t("progress.detail.tiles.maxHr")} value={t("progress.detail.tooltip.hr", { bpm: run.hrMax })} />}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col animate-slide-up">
      {header}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-lg w-full mx-auto"
        style={{ paddingBottom: "calc(1rem + var(--safe-bottom))" }}>

        {route === undefined && hasTrace && (
          <div className="h-56 rounded-xl bg-slate-800 flex items-center justify-center text-slate-500 text-sm">
            {t("progress.history.loadingRoute")}
          </div>
        )}

        {hasPoints && route && (
          <>
            <RouteMap points={route.points} interactive className="h-56 rounded-xl overflow-hidden" />

            {/* Series toggles + combined chart */}
            <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap gap-1">
                {hasElev && <Chip on={show.elev} color={ELEV_CLR} label={t("progress.detail.series.elevation")}
                  onToggle={() => setShow(s => ({ ...s, elev: !s.elev }))} />}
                <Chip on={show.pace} color={PACE_CLR} label={t("progress.detail.series.pace")}
                  onToggle={() => setShow(s => ({ ...s, pace: !s.pace }))} />
                {hasHr && <Chip on={show.hr} color={HR_CLR} label={t("progress.detail.series.heartRate")}
                  onToggle={() => setShow(s => ({ ...s, hr: !s.hr }))} />}
              </div>
              <RunChart series={series} show={show} hasElev={hasElev} hasHr={hasHr} />
            </div>

            {/* HR time-in-zone (BLE runs only) */}
            {zoneTotal > 0 && (
              <div className="bg-slate-800 rounded-2xl p-4">
                <p className="text-slate-400 text-sm font-medium mb-3">{t("progress.detail.zones.title")}</p>
                <div className="flex rounded-lg overflow-hidden h-4 mb-3">
                  {zones.map(z => z.sec > 0 && (
                    <div key={z.zone} style={{ background: HR_ZONES[z.zone - 1].clr, width: (z.sec / zoneTotal * 100) + "%" }} />
                  ))}
                </div>
                <div className="space-y-1">
                  {zones.filter(z => z.sec > 0).map(z => (
                    <div key={z.zone} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-slate-300">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: HR_ZONES[z.zone - 1].clr }} />
                        {t("progress.detail.zones.zone", { n: z.zone })}
                      </span>
                      <span className="text-slate-400 tabular-nums">{fmt.mins(Math.round(z.sec / 60))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Per-km splits */}
            {splits.length > 0 && (
              <div className="bg-slate-800 rounded-2xl p-4">
                <p className="text-slate-400 text-sm font-medium mb-3">{t("progress.detail.splits.title")}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 text-xs text-left">
                      <th className="font-medium pb-2">{t("progress.detail.splits.km")}</th>
                      <th className="font-medium pb-2 text-right">{t("progress.detail.splits.pace")}</th>
                      <th className="font-medium pb-2 text-right">{t("progress.detail.splits.elevation")}</th>
                      {hasHr && <th className="font-medium pb-2 text-right">{t("progress.detail.splits.hr")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {splits.map(s => (
                      <tr key={s.km} className={"tabular-nums " + (s.fastest ? "text-emerald-400" : s.slowest ? "text-amber-400" : "text-slate-200")}>
                        <td className="py-1">{s.distKm >= 0.999 ? s.km : t("progress.detail.splits.partial", { km: s.distKm.toFixed(2) })}</td>
                        <td className="py-1 text-right">{fmt.pace(s.paceSecPerKm)}</td>
                        <td className="py-1 text-right text-slate-400">{s.elevGainM > 0 ? "+" + s.elevGainM + " m" : "—"}</td>
                        {hasHr && <td className="py-1 text-right text-slate-400">{s.avgHr != null ? s.avgHr : "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Resolved but nothing to chart: a failed/absent fetch, OR a route that
            exists yet has no usable points (e.g. Stop tapped before any GPS fix).
            Without this, that empty-points case rendered a blank gap. */}
        {route !== undefined && !hasPoints && (
          <p className="text-slate-500 text-sm text-center">
            {t(hasTrace ? "progress.history.routeUnavailable" : "progress.detail.noRoute")}
          </p>
        )}

        {tiles}

        {run.notes && <p className="text-slate-400 text-sm">{run.notes}</p>}
      </div>
    </div>
  );
}
