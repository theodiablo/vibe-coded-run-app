// Lock-screen live run stats — Android seam.
//
// Pushes distance/pace/HR into the background-geolocation foreground-service
// notification via the patched plugin's `updateNotification` method (see
// patches/). The ticking duration is NOT pushed from here: the notification is
// posted with an OS-rendered chronometer (see src/utils/runNotification.ts), so
// the clock keeps counting while the WebView is throttled in the background —
// this seam only fires when data changes, from the tracker's bridge-callback-
// driven renders. No-op on web and iOS (iOS gets a Live Activity in Phase 2).
//
// Best-effort by design: a notification failure must never affect recording.

import { registerPlugin } from "@capacitor/core";
import { isAndroid } from "../native";
import { t } from "../i18n";
import { sameNotificationContent, type RunNotificationContent } from "../utils/runNotification";

type UpdateNotificationPlugin = {
  updateNotification: (options: {
    title: string;
    message: string;
    chronometerStartMs?: number;
  }) => Promise<{ updated?: boolean }>;
};

// Same plugin name as src/geo/native.ts — registerPlugin returns a proxy per
// call site; both address the one native instance.
const BackgroundGeolocation = registerPlugin<UpdateNotificationPlugin>("BackgroundGeolocation");

let lastSent: RunNotificationContent | null = null;
let lastApplied = false; // native confirmed the update landed on the notification
let inflight = false;

/**
 * Push run stats to the foreground-service notification. Deduped against the
 * last content the native side CONFIRMED (`updated: true`), so a push that
 * raced ahead of the watcher/service starting is retried on the next call
 * instead of being silently lost. Fire-and-forget; never throws.
 */
export function pushRunNotification(content: RunNotificationContent): void {
  if (!isAndroid) return;
  if (inflight) return; // a fresher push will follow on the next data change
  if (lastApplied && sameNotificationContent(lastSent, content)) return;
  inflight = true;
  lastSent = content;
  BackgroundGeolocation.updateNotification({
    title: t(`tracker.notif.${content.titleKey}`),
    message: content.message,
    ...(content.chronometerStartMs != null ? { chronometerStartMs: content.chronometerStartMs } : {}),
  })
    .then((res) => { lastApplied = res?.updated === true; })
    .catch(() => { lastApplied = false; })
    .finally(() => { inflight = false; });
}

/** Forget the dedupe state (run ended — the watcher removal clears the notification itself). */
export function resetRunNotification(): void {
  lastSent = null;
  lastApplied = false;
}
