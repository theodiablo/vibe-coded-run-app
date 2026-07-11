// Map a Health Connect record's dataOrigin (the writing app's Android package)
// to a friendly brand label for run notes ("Imported from Zepp"). Names are used
// nominatively only — no logos or endorsement wording. Unknown packages fall
// back to a generic label so new brands work without a code change.
const ORIGIN_LABELS: Record<string, string> = {
  "com.garmin.android.apps.connectmobile": "Garmin",
  "com.huami.watch.hmwatchmanager": "Zepp",           // Amazfit's companion app
  "com.zepp.zepposapp": "Zepp",
  "com.xiaomi.wearable": "Mi Fitness",
  "com.mc.miband1": "Notify",                          // Notify for Amazfit/Mi Band
  "com.fitbit.FitbitMobile": "Fitbit",
  "com.sec.android.app.shealth": "Samsung Health",
  "com.google.android.apps.fitness": "Google Fit",
  "com.polar.polarflow": "Polar",
  "com.suunto.movescount.android": "Suunto",
  "com.coros.coros": "COROS",
  "com.google.android.apps.healthdata": "Health Connect",
};

export function dataOriginLabel(pkg?: string | null): string {
  if (!pkg) return "your watch";
  return ORIGIN_LABELS[pkg] || "your watch";
}

// The note stamped on an imported run, e.g. "Imported from Garmin".
export function importedNote(pkg?: string | null): string {
  return "Imported from " + dataOriginLabel(pkg);
}
