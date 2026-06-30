import { HeartPulse } from "lucide-react";
import { PRIVACY_URL } from "../constants";

// Prominent disclosure shown before the first Bluetooth permission prompt when
// pairing a heart-rate sensor (native shell). Mirrors BgLocationDisclosure: the
// user accepts in-app, then the OS dialog gates the actual BLUETOOTH_SCAN/CONNECT
// grant. Gated once per install in SettingsModal via HR_BLE_DISCLOSED_KEY.
export function HrSensorDisclosure({ onAccept, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/70 z-[2000] flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto border border-slate-700">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
          <HeartPulse size={16} className="text-orange-400" />
          <p className="font-semibold text-sm">Connect a heart-rate sensor</p>
        </div>
        <div className="p-4 space-y-3 text-sm text-slate-300">
          <p>
            To read your heart rate during a run, Running Coach connects to a nearby
            <strong> Bluetooth heart-rate sensor</strong> — a chest strap, an armband,
            or a watch broadcasting its heart rate.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[13px] text-slate-400">
            <li>Bluetooth is used <strong>only to find and read your sensor</strong> — never for location.</li>
            <li>Your heart rate is saved on your run, in your own account.</li>
            <li>Nothing is sold or shared with third parties.</li>
          </ul>
          <p className="text-[13px] text-slate-400">
            See our{" "}
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer"
              className="text-orange-400 underline">Privacy Policy</a>. When you tap
            Allow, Android will ask to use nearby Bluetooth devices.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={onCancel}
              className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200">
              Not now
            </button>
            <button onClick={onAccept}
              className="py-2.5 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white">
              Allow &amp; continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
