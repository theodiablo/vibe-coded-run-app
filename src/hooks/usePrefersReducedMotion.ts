import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// Whether the OS "reduce motion" accessibility setting is on. Styling degrades
// globally via the media query in index.css; this hook is only for the couple
// of places that change *behaviour* (skip the run-start countdown, render no
// confetti) rather than just shortening a duration. jsdom has no matchMedia, so
// guard the read — tests that don't stub it fall through to `false`.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window.matchMedia !== "function") return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
