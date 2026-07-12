import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { ChunkLoadBoundary } from "./ChunkLoadBoundary";

function Throw({ error }: { error: Error }): ReactNode {
  throw error;
}

// A trivial outer boundary so a re-thrown error doesn't fail the test as an
// uncaught render exception — it stands in for the app-wide ErrorBoundary.
class Catcher extends Component<{ children: ReactNode }, { caught: Error | null }> {
  state = { caught: null as Error | null };
  static getDerivedStateFromError(caught: Error) {
    return { caught };
  }
  render() {
    return this.state.caught ? <div>outer caught: {this.state.caught.message}</div> : this.props.children;
  }
}

describe("ChunkLoadBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders children when nothing throws", () => {
    render(
      <ChunkLoadBoundary fallback={<div>fallback</div>}>
        <div>content</div>
      </ChunkLoadBoundary>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByText("fallback")).not.toBeInTheDocument();
  });

  it.each([
    "Failed to fetch dynamically imported module: /assets/x-abc.js",
    "Loading chunk 42 failed",
    "error loading dynamically imported module",
    "Importing a module script failed",
  ])("shows the fallback on a chunk-load error: %s", (message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Catcher>
        <ChunkLoadBoundary fallback={<div>fallback</div>}>
          <Throw error={new Error(message)} />
        </ChunkLoadBoundary>
      </Catcher>,
    );
    expect(screen.getByText("fallback")).toBeInTheDocument();
    expect(screen.queryByText(/outer caught/)).not.toBeInTheDocument();
  });

  it("re-throws a genuine (non-chunk) render error to the outer boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Catcher>
        <ChunkLoadBoundary fallback={<div>fallback</div>}>
          <Throw error={new Error("Cannot read properties of undefined (reading 'id')")} />
        </ChunkLoadBoundary>
      </Catcher>,
    );
    expect(screen.getByText(/outer caught/)).toBeInTheDocument();
    expect(screen.queryByText("fallback")).not.toBeInTheDocument();
  });
});
