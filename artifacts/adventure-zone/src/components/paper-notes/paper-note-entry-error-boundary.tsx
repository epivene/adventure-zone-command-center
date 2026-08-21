import { Component, type ErrorInfo, type ReactNode } from "react";

export class PaperNoteEntryErrorBoundary extends Component<{
  entryId: string;
  children: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Paper Notes entry render failed", {
      entryId: this.props.entryId,
      errorName: error.name,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(previous: Readonly<{ entryId: string; children: ReactNode }>) {
    if (previous.entryId !== this.props.entryId && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" role="alert">
        <p className="font-bold">This paper entry hit an error.</p>
        <p className="mt-1">Your saved batch is still there. Reload this entry and keep reviewing.</p>
        <button
          className="mt-3 min-h-11 rounded-lg border border-rose-300 bg-white px-3 py-2 font-bold text-rose-900"
          onClick={() => window.location.reload()}
          type="button"
        >
          Reload this entry
        </button>
      </div>
    );
  }
}
