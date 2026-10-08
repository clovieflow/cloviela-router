import { Component, type ErrorInfo, type ReactNode } from "react";
import { LocaleProvider } from "../shared/locale-context";
import SystemError from "../routes/SystemError";

interface ErrorBoundaryProps {
  /** Distinguishes navigation targets. A change clears a recovered error so a
   * transient lazy-chunk load failure at one route never pins the whole shell
   * to the error surface when the user navigates elsewhere. */
  readonly resetKey: string;
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * Root error boundary for the console shell.
 *
 * Lazy route imports can fail on a transient chunk fetch; rather than leaving
 * a blank viewport the boundary renders the localized `SystemError` recovery
 * surface, which shows a copyable diagnostic id, the interface error message,
 * a retry that clears the boundary, and a reload as the last resort.
 *
 * ── Why it re-provides `LocaleProvider` ────────────────────────────────────
 * This boundary sits *above* the route tree, so when the failure is inside a
 * page it is still under the app's provider and reads the operator's locale.
 * But `App` mounts its provider inside the query client and a failure during
 * the provider's own subtree would leave the fallback with no context. Wrapping
 * the fallback in a fresh provider (reading the same persisted preference) is
 * what keeps the recovery screen in the operator's language in both cases.
 * It is a fallback-only wrapper: the success path renders `children` untouched.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The stack is developer-facing; the operator sees the message plus the
    // diagnostic id on the recovery surface.
    console.error("[console] route render failed:", error, info.componentStack);
  }

  override componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <LocaleProvider>
        <SystemError error={this.state.error} onReset={this.reset} />
      </LocaleProvider>
    );
  }
}
