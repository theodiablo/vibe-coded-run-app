import { useEffect, useRef } from "react";
import { pushDismiss } from "../utils/backDismiss";

// Registers an overlay's dismiss handler on the global back-dismiss stack while
// `active` is true, so Escape (web) / the Android back button closes it. Most
// modals mount only while open, so they pass `active={true}`; a component that
// keeps an always-mounted body with internal open-state (e.g. InfoButton) passes
// its open flag.
//
// `onDismiss` is read through a ref so the registration doesn't churn (and thus
// reorder the stack) when the handler is an inline closure — the stack entry is
// created once per open and always calls the latest handler, capturing current
// state at press time.
export function useDismissable(active: boolean, onDismiss: () => void) {
  const ref = useRef(onDismiss);
  useEffect(() => {
    ref.current = onDismiss;
  });
  useEffect(() => {
    if (!active) return;
    return pushDismiss(() => ref.current());
  }, [active]);
}
