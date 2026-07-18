import { Component, type ReactNode } from "react";

// A dynamic `import()` (React.lazy, route-level code splitting) can fail at
// runtime even in a perfectly healthy app: the most common cause is a *stale
// chunk* — the site was redeployed to S3/CloudFront while the user's tab stayed
// open, so the hashed chunk the loaded bundle asks for no longer exists and the
// fetch 404s. A transient network drop does the same. Without a boundary around
// the Suspense, that rejection propagates to the app-wide ErrorBoundary and
// white-screens the whole app.
//
// This bites hardest on **sign-out**: a signed-in session never loads the
// web-only marketing chunk, so signing out is the first (and often only) time a
// long-lived session ever fetches it — precisely when a mid-session redeploy has
// had time to rotate the chunk. Signing out should never throw the app into the
// crash screen, so we catch the load failure here and render a fallback (the
// statically-imported LoginScreen) instead.
//
// Only *chunk-load* errors are swallowed. A genuine render bug inside the lazy
// subtree is re-thrown so the app-wide ErrorBoundary still surfaces it (crash
// UI + telemetry), rather than being silently masked by the fallback.

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return (
    /ChunkLoadError/i.test(msg) ||
    /dynamically imported module/i.test(msg) || // Vite / Chrome
    /Loading chunk [\w-]+ failed/i.test(msg) || // webpack-style
    /Importing a module script failed/i.test(msg) || // Safari
    /error loading dynamically imported module/i.test(msg) || // Firefox
    /Failed to fetch/i.test(msg)
  );
}

// `onError` fires once, in componentDidCatch, only for a swallowed *chunk-load*
// error — a place where side-effects are allowed. A modal gate (e.g. the lazy
// CoachChat) uses it to close itself and toast "check your connection", so a
// transient/stale-chunk failure degrades gracefully instead of white-screening,
// and unmounting the boundary resets it so the next open retries the import.
type Props = { fallback: ReactNode; children: ReactNode; onError?: (error: unknown) => void };
type State = { failed: boolean; error: Error | null };

export class ChunkLoadBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { failed: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { failed: true, error };
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) this.props.onError?.(error);
  }

  render() {
    if (this.state.failed) {
      // Re-throw non-chunk errors so the app-wide ErrorBoundary handles them
      // (a real render bug should not be hidden behind the fallback).
      if (!isChunkLoadError(this.state.error)) throw this.state.error;
      return this.props.fallback;
    }
    return this.props.children;
  }
}
