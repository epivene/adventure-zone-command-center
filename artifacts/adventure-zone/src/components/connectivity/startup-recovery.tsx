import { Component, type CSSProperties, type ReactNode } from "react";

const linkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 44,
  padding: "0 16px",
  border: "1px solid #0f766e",
  borderRadius: 8,
  color: "#115e59",
  background: "#ffffff",
  fontWeight: 600,
  textDecoration: "underline",
};

/** A rejected route chunk must leave recovery controls instead of an empty root. */
export class StartupRecovery extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
    return (
      <main style={{ minHeight: "100dvh", padding: "48px 20px", background: "#f8fafc", color: "#0f172a", fontFamily: "Arial, sans-serif", lineHeight: 1.5 }}>
        <section role="alert" style={{ maxWidth: 560, margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 16px", fontSize: 26 }}>The app could not finish loading</h1>
          <p>Reconnect to the internet and try again.</p>
          <p>If you prepared records for offline use, you can open the saved workspace. Otherwise, reconnect, open a conversation, and choose <strong>Prepare for offline</strong>. Keep it open until preparation completes.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
            <button type="button" onClick={() => window.location.reload()} style={{ ...linkStyle, font: "inherit", fontWeight: 600, cursor: "pointer" }}>Try again</button>
            <a href={`${base}assistant/offline`} style={linkStyle}>Open saved offline workspace</a>
          </div>
        </section>
      </main>
    );
  }
}
