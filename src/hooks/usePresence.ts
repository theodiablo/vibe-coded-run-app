import { useEffect, useState } from "react";

type Presence<T> = {
  /** The value to render — held for `exitMs` after `value` goes null. */
  rendered: T | null;
  /** True while the held value is animating out (drives the exit class). */
  closing: boolean;
};

// Keeps a value mounted briefly after it becomes null so an exit animation can
// play, then clears it. Used for the global toast, which otherwise hard-unmounts
// the instant its auto-dismiss timer fires. The live<->null transition is
// tracked with the derived-state-during-render pattern (compare against the
// previous value during render) rather than an effect, because the react-hooks
// lint rule forbids synchronous setState inside effects. The delayed clear is
// the effect's only job: its cleanup cancels the pending timer whenever
// `closing` flips back to false, so a fresh value arriving during the exit tail
// swaps in immediately without being blanked by the stale timer.
export function usePresence<T>(value: T | null, exitMs: number): Presence<T> {
  const [rendered, setRendered] = useState<T | null>(value);
  const [closing, setClosing] = useState(false);
  const [prev, setPrev] = useState<T | null>(value);

  if (value !== prev) {
    setPrev(value);
    if (value !== null) {
      // Appearing or swapping to a new value: show it now and drop out of the
      // closing state (which re-runs the effect and clears any pending close).
      setRendered(value);
      setClosing(false);
    } else if (rendered !== null) {
      // Disappearing: keep the last value on screen and mark it closing.
      setClosing(true);
    }
  }

  useEffect(() => {
    if (!closing) return;
    const id = setTimeout(() => {
      setRendered(null);
      setClosing(false);
    }, exitMs);
    return () => clearTimeout(id);
  }, [closing, exitMs]);

  return { rendered, closing };
}
