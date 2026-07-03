// Tiny shared pieces for the app's full-screen overlay sheets (prominent
// disclosures, confirm-style nudges) — the backdrop/positioning and the
// accept/cancel button pair were being hand-copied into every one of them,
// so a z-index or styling fix (like the Toast bump to sit above these) had
// to be applied in three places by hand instead of one.

// Full-screen dim backdrop, centered content, consistent stacking above the
// live tracker (z-50) and other in-app sheets.
export function ModalOverlay({ children }) {
  return (
    <div className="fixed inset-0 bg-black/70 z-[2000] flex items-center justify-center p-4">
      {children}
    </div>
  );
}

// The cancel/accept button pair shared by every disclosure and confirm sheet.
export function ConfirmButtons({ onCancel, onAccept, cancelLabel, acceptLabel }) {
  return (
    <div className="grid grid-cols-2 gap-2 pt-1">
      <button onClick={onCancel}
        className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200">
        {cancelLabel}
      </button>
      <button onClick={onAccept}
        className="py-2.5 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white">
        {acceptLabel}
      </button>
    </div>
  );
}
