// Lock-screen live run stats — the native seam.
//
// One JS contract, two platform backends:
//   - Android: the background-geolocation foreground-service notification,
//     via the patched plugin's `updateNotification` method (see patches/).
//   - iOS: a Live Activity (lock screen + Dynamic Island), via the local
//     LiveActivityPlugin (ios/App/App/LiveActivityPlugin.swift) — push()
//     starts-or-updates, end() dismisses.
//
// The ticking duration is NOT pushed from here on either platform: Android
// renders an OS chronometer, iOS renders Text(style: .timer), both anchored at
// chronometerStartMs (see src/utils/runNotification.ts) — so the clock keeps
// counting while the WebView is throttled in the background. This seam only
// fires when data changes, from the tracker's bridge-callback-driven renders.
// No-op on web. Best-effort by design: a display failure must never affect
// recording.

import { registerPlugin } from "@capacitor/core";
import { isAndroid, isIos } from "../native";
import { t } from "../i18n";
import { sameNotificationContent, type RunNotificationContent } from "../utils/runNotification";

type PushOptions = {
  title: string;
  message: string;
  chronometerStartMs?: number;
};
type PushResult = { updated?: boolean };

// Same plugin name as src/geo/native.ts — registerPlugin returns a proxy per
// call site; both address the one native instance.
const BackgroundGeolocation = registerPlugin<{
  updateNotification: (options: PushOptions) => Promise<PushResult>;
}>("BackgroundGeolocation");

const LiveActivity = registerPlugin<{
  push: (options: PushOptions) => Promise<PushResult>;
  end: () => Promise<void>;
}>("LiveActivity");

let lastSent: RunNotificationContent | null = null;
let lastApplied = false; // native confirmed the update landed
let inflight = false;
// False once something was pushed; resetRunNotification flips it back and (on
// iOS) ends the Live Activity exactly once per run — including a stale card
// left behind by a crashed session, swept by the first reset after mount.
let cleared = false;

/**
 * Push run stats to the platform's lock-screen surface. Deduped against the
 * last content the native side CONFIRMED (`updated: true`), so a push that
 * raced ahead of the watcher/service (Android) or was refused (iOS) is retried
 * on the next call instead of being silently lost. Fire-and-forget; never throws.
 */
export function pushRunNotification(content: RunNotificationContent): void {
  if (!isAndroid && !isIos) return;
  if (inflight) return; // a fresher push will follow on the next data change
  if (lastApplied && sameNotificationContent(lastSent, content)) return;
  inflight = true;
  cleared = false;
  lastSent = content;
  const options: PushOptions = {
    title: t(`tracker.notif.${content.titleKey}`),
    message: content.message,
    ...(content.chronometerStartMs != null ? { chronometerStartMs: content.chronometerStartMs } : {}),
  };
  (isAndroid ? BackgroundGeolocation.updateNotification(options) : LiveActivity.push(options))
    .then((res) => { lastApplied = res?.updated === true; })
    .catch(() => { lastApplied = false; })
    .finally(() => { inflight = false; });
}

/**
 * Run over — forget the dedupe state and tear down the iOS Live Activity.
 * (On Android the watcher removal clears the notification itself.)
 */
export function resetRunNotification(): void {
  lastSent = null;
  lastApplied = false;
  if (cleared) return;
  cleared = true;
  if (isIos) LiveActivity.end().catch(() => { /* best-effort */ });
}
