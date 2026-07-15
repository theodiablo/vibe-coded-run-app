import { BleClient, numberToUUID } from "@capacitor-community/bluetooth-le";
import { parseHrMeasurement } from "../utils/hr";

// Live heart-rate source: a standard Bluetooth LE Heart Rate sensor (chest strap,
// optical armband, or a watch broadcasting over the Heart Rate Profile — e.g.
// Amazfit "Heart Rate Push"). Implements the LiveHrSource contract consumed by
// useRunTracker (isAvailable / scan / requestPermissions / watch / clearWatch),
// the HR analogue of geoSource. Selected only in the native shell (see source.js);
// the @capacitor-community/bluetooth-le JS is bundled but never executed on web.
//
// Standard GATT Heart Rate Profile: service 0x180D, measurement char 0x2A37.
const HR_SERVICE = numberToUUID(0x180d);
const HR_MEASUREMENT = numberToUUID(0x2a37);

type BleWatchOptions = { deviceId?: string };
export type BleDevice = { id: string; name: string };
export type BleHrSample = { bpm: number; t: number };
export type BleWatchHandle = { deviceId?: string; stopped: boolean };

let initialized = false;
async function ensureInit() {
  if (!initialized) {
    // androidNeverForLocation: pair with the BLUETOOTH_SCAN neverForLocation flag
    // in the manifest so scanning never implies location access.
    await BleClient.initialize({ androidNeverForLocation: true });
    initialized = true;
  }
}

const bleSourceImpl = {
  id: "bluetooth" as const,
  live: true as const,

  // True only when BLE is usable (initialized + adapter on). Never throws.
  async isAvailable() {
    try { await ensureInit(); return await BleClient.isEnabled(); }
    catch { return false; }
  },

  // Scan for HR-profile peripherals for `ms`, reporting each unique device as
  // {id,name} via onDevice. Resolves when the scan window ends. Initializing /
  // scanning triggers the Android 12+ BLUETOOTH_SCAN/CONNECT runtime prompt.
  async scan(onDevice: (device: BleDevice) => void, ms = 8000) {
    await ensureInit();
    const seen = new Set();
    await BleClient.requestLEScan({ services: [HR_SERVICE] }, (result) => {
      const id = result.device.deviceId;
      if (seen.has(id)) return;
      seen.add(id);
      onDevice({ id, name: result.device.name || result.localName || "Heart-rate sensor" });
    });
    await new Promise((resolve) => setTimeout(resolve, ms));
    try { await BleClient.stopLEScan(); } catch { /* already stopped — ignore */ }
  },

  // Surface the OS Bluetooth permission prompt (via initialize) ahead of a run.
  async requestPermissions() {
    try { await ensureInit(); return true; }
    catch { return false; }
  },

  // Connect to the paired deviceId and stream { bpm, t } samples to onSample.
  // Auto-reconnects with capped backoff on an unsolicited disconnect so a strap
  // dropping mid-run doesn't end HR capture. Returns a handle for clearWatch.
  watch(onSample: (sample: BleHrSample) => void, onErr?: (error: unknown) => void, { deviceId }: BleWatchOptions = {}) {
    const handle: BleWatchHandle = { deviceId, stopped: false };
    if (!deviceId) { onErr?.(new Error("No heart-rate sensor paired.")); return handle; }
    let backoff = 1000;
    const start = async () => {
      // iOS cold-launch gotcha: CoreBluetooth can only connect to a peripheral
      // this app session has *retrieved* — a deviceId saved on a previous
      // launch must be re-materialized via getDevices() first or connect()
      // rejects with "device not found". No-op when the device is already
      // known (post-scan, or Android); real failures still surface in connect.
      try { await BleClient.getDevices([deviceId]); } catch { /* connect() reports the actionable error */ }
      await BleClient.connect(deviceId, () => { if (!handle.stopped) retry(); });
      // clearWatch may have run while connect() was in flight (e.g. the run was
      // discarded/finished before a slow/out-of-range sensor finished connecting).
      // Don't subscribe to a device we were told to stop watching — disconnect
      // immediately instead, so a stopped watch can never leave a live BLE
      // connection (and its notification stream) running in the background.
      if (handle.stopped) { try { await BleClient.disconnect(deviceId); } catch { /* ignore */ } return; }
      await BleClient.startNotifications(deviceId, HR_SERVICE, HR_MEASUREMENT, (value) => {
        const parsed = parseHrMeasurement(value);
        if (parsed) onSample({ bpm: parsed.bpm, t: Date.now() });
      });
      backoff = 1000; // reset after a clean (re)connect
    };
    const retry = () => {
      if (handle.stopped) return;
      setTimeout(() => {
        if (handle.stopped) return;
        start().catch(() => { backoff = Math.min(backoff * 2, 15000); retry(); });
      }, backoff);
    };
    (async () => {
      try { await ensureInit(); await start(); }
      catch (e) { onErr?.(e); retry(); }
    })();
    return handle;
  },

  async clearWatch(handle?: BleWatchHandle | null) {
    if (!handle) return;
    handle.stopped = true;
    if (!handle.deviceId) return;
    try { await BleClient.stopNotifications(handle.deviceId, HR_SERVICE, HR_MEASUREMENT); } catch { /* ignore */ }
    try { await BleClient.disconnect(handle.deviceId); } catch { /* ignore */ }
  },
};

export const bleSource = bleSourceImpl as typeof bleSourceImpl & { fetchRange?: never };
