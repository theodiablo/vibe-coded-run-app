// Map a recharts mouse-event chart state to the active data index, or null.
//
// recharts v3 reports `activeTooltipIndex` as a STRING for Line/Area/Composed
// charts (`combineActiveTooltipIndex` returns `String(clampedIndex)`), so a bare
// `typeof === "number"` check is ALWAYS false and would leave a chart→map cursor
// permanently null. Coerce and validate to the numeric index (which aligns 1:1
// with the flattened track in RunDetailModal), or null. Pure + unit-tested.
export function activeIndexFromChartState(
  s: { activeTooltipIndex?: number | string | null } | null | undefined,
): number | null {
  const raw = s == null ? null : s.activeTooltipIndex;
  if (raw == null || raw === "") return null;
  const i = Number(raw);
  return Number.isInteger(i) && i >= 0 ? i : null;
}
