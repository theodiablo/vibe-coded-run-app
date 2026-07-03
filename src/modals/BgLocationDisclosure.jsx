import { MapPin } from "lucide-react";
import { PRIVACY_URL } from "../constants";
import { ModalOverlay, ConfirmButtons } from "../components/ModalPrimitives";

// Prominent disclosure for background location, shown in the native shell BEFORE
// the OS permission prompt (a Google Play requirement for ACCESS_BACKGROUND_LOCATION).
// The user must affirmatively accept this in-app screen; the OS dialog then gates
// the actual grant. See LiveRunTracker for the once-per-install gating.
export function BgLocationDisclosure({ onAccept, onCancel }) {
  return (
    <ModalOverlay>
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto border border-slate-700">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
          <MapPin size={16} className="text-orange-400" />
          <p className="font-semibold text-sm">Background location</p>
        </div>
        <div className="p-4 space-y-3 text-sm text-slate-300">
          <p>
            To record your run accurately, Running Coach collects your <strong>location
            in the background</strong> — including <strong>while the app is closed or the
            screen is off</strong>.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[13px] text-slate-400">
            <li>Collected <strong>only while a run is recording</strong> — never at any other time.</li>
            <li>Used to draw your route and compute distance, pace, and elevation.</li>
            <li>Stored in your own account; never sold or shared with third parties.</li>
          </ul>
          <p className="text-[13px] text-slate-400">
            See our{" "}
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer"
              className="text-orange-400 underline">Privacy Policy</a>. When you tap
            Allow, Android will ask to use your location — choose <strong>“Allow all
            the time”</strong> for screen-off tracking.
          </p>
          <ConfirmButtons cancelLabel="Not now" acceptLabel="Allow & continue"
            onCancel={onCancel} onAccept={onAccept} />
        </div>
      </div>
    </ModalOverlay>
  );
}
