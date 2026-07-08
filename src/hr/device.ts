import { HR_DEVICE_KEY } from "../constants";
import type { BleDevice } from "./ble";

// The paired BLE heart-rate sensor ({id,name}) is stored PER-DEVICE in
// localStorage — never in the synced settings blob — because Bluetooth bonding
// is local to the phone (see HR_DEVICE_KEY in constants.js). These are the only
// readers/writers, so the storage shape can't drift.
export function getPairedDevice(): BleDevice | null {
  try {
    const raw = localStorage.getItem(HR_DEVICE_KEY);
    if (!raw) return null;
    const device = JSON.parse(raw) as Partial<BleDevice>;
    return typeof device.id === "string" ? { id: device.id, name: device.name || "Heart-rate sensor" } : null;
  }
  catch { return null; }
}

export function setPairedDevice(device: BleDevice) {
  try { localStorage.setItem(HR_DEVICE_KEY, JSON.stringify(device)); } catch { /* quota — non-fatal */ }
}

export function forgetPairedDevice() {
  try { localStorage.removeItem(HR_DEVICE_KEY); } catch { /* ignore */ }
}
