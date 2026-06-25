import { Component } from "react";
import { AlertTriangle } from "lucide-react";
import { isNative } from "../native";
import { getConsent, captureError } from "../telemetry";

// App-wide crash guard. A render-time exception anywhere below this boundary
// would otherwise white-screen the user; instead we show a friendly fallback
// with a reload, and feed the crash to telemetry under the consent rules:
//
//   • web   — auto-report when the user hasn't opted out of analytics.
//   • native — hold the report and ask the user, per crash, whether to send it
//     (their explicit requirement). Nothing is uploaded until they tap "Send".
//
// Class component because error boundaries have no hooks equivalent.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    // decision: null = undecided (native prompt showing), "sent" | "declined".
    this.state = { error: null, decision: null };
    this.info = null;
  }

  static getDerivedStateFromError(error) {
    return { error, decision: null };
  }

  componentDidCatch(error, info) {
    this.info = info;
    // Web auto-reports (consent permitting); native waits for the user.
    if (!isNative && getConsent()) {
      this.report();
      this.setState({ decision: "sent" });
    }
  }

  report() {
    captureError(this.state.error, {
      kind: "react",
      componentStack: this.info?.componentStack,
    });
  }

  send = () => {
    this.report();
    this.setState({ decision: "sent" });
  };

  decline = () => this.setState({ decision: "declined" });

  // Full reload — after a render crash the React tree is in an unknown state.
  reload = () => window.location.reload();

  render() {
    if (!this.state.error) return this.props.children;

    // Show the per-crash report prompt only on native, only while undecided.
    const askToSend = isNative && this.state.decision === null;

    return (
      <div className="h-screen bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-slate-800 rounded-2xl p-6 text-center space-y-4">
          <div className="flex justify-center">
            <AlertTriangle className="text-orange-400" size={32} />
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold">Something went wrong</p>
            <p className="text-sm text-slate-400">
              The app hit an unexpected error. Reloading usually fixes it — your
              runs and plan are saved.
            </p>
          </div>

          {askToSend ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">
                Send an anonymous crash report to help fix this?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={this.decline}
                  className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">
                  Don&apos;t send
                </button>
                <button onClick={this.send}
                  className="py-2.5 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors">
                  Send report
                </button>
              </div>
            </div>
          ) : (
            <>
              {this.state.decision === "sent" && (
                <p className="text-xs text-emerald-400">Crash report sent. Thank you.</p>
              )}
              <button onClick={this.reload}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors">
                Reload
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
}
