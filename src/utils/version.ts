// Version helpers for the in-app update gate (native app only). The installed
// app version (Capacitor App.getInfo().version = the Gradle versionName) is
// compared against a remote config row (public.app_config) to decide whether to
// nudge or force an update.

// Compare dotted numeric versions ("1.2.0"). Returns -1 / 0 / 1. Any pre-release
// suffix ("-beta") is ignored, and missing segments count as 0 (so "1.2" === "1.2.0").
export function compareVersions(a, b) {
  const parse = v => String(v).split("-")[0].split(".").map(n => parseInt(n, 10) || 0);
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// What to tell the user given the installed version and the remote config.
//   "must-update"      — below the supported floor (e.g. a breaking backend change)
//   "update-available" — usable but a newer version exists
//   "ok"               — current, unknown (web), or config unavailable → never block
export function versionStatus(current, config) {
  if (!current || !config) return "ok";
  if (compareVersions(current, config.min_supported_version) < 0) return "must-update";
  if (compareVersions(current, config.latest_version) < 0) return "update-available";
  return "ok";
}
