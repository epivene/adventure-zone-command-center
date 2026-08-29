import { useState, type CSSProperties } from "react";
import { ArrowUpRight, BriefcaseBusiness, MapPinned, Shield, Sparkles, Zap } from "lucide-react";

type WorkspaceId = "office" | "manager";

const workspaces: Array<{
  id: WorkspaceId;
  label: string;
  detail: string;
  eyebrow: string;
  icon: typeof BriefcaseBusiness;
}> = [
  {
    id: "office",
    label: "Office Coordinator",
    detail: "Bookings, contacts, routes, and calls",
    eyebrow: "Workspace 01",
    icon: BriefcaseBusiness,
  },
  {
    id: "manager",
    label: "Leg Managers",
    detail: "Field-ready operations and trip planning",
    eyebrow: "Workspace 02",
    icon: MapPinned,
  },
];

export function SplitLanding() {
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceId>("office");
  const [adminOpen, setAdminOpen] = useState(false);

  return (
    <main className="az-landing" style={{ "--az-bg": "#f3f5f0", "--az-fg": "#173b48", "--az-border": "#d8e2dd", "--az-card": "#fbfcf8", "--az-primary": "#d51352", "--az-primary-foreground": "#fff7fa", "--az-secondary": "#fde7ef", "--az-secondary-foreground": "#8e123f", "--az-muted": "#f8f0f3", "--az-muted-foreground": "#71848a", "--az-accent": "#d4874f", "--az-accent-foreground": "#fffaf3", "--az-sidebar": "#173b48", "--az-sidebar-foreground": "#f8f5ee" } as CSSProperties}>
      <style>{`
        .az-landing {
          --az-shadow: 0 24px 64px rgba(23, 59, 72, 0.12);
          min-height: 100dvh;
          overflow: hidden;
          position: relative;
          background:
            radial-gradient(circle at 12% 8%, rgba(213, 19, 82, 0.07), transparent 28rem),
            radial-gradient(circle at 92% 92%, rgba(212, 135, 79, 0.10), transparent 24rem),
            var(--az-bg);
          color: var(--az-fg);
          font-family: "DM Sans", ui-sans-serif, system-ui, sans-serif;
        }

        .az-landing::before {
          background-image: linear-gradient(rgba(23, 59, 72, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(23, 59, 72, 0.035) 1px, transparent 1px);
          background-size: 3rem 3rem;
          content: "";
          inset: 0;
          mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.7), transparent 70%);
          pointer-events: none;
          position: absolute;
        }

        .az-landing *, .az-landing *::before, .az-landing *::after { box-sizing: border-box; }
        .az-landing button { font: inherit; }
        .az-frame { margin: 0 auto; max-width: 82rem; padding: 1.25rem 1.25rem 1.5rem; position: relative; z-index: 1; }
        .az-topbar { align-items: center; display: flex; justify-content: space-between; min-height: 3rem; }
        .az-brand { align-items: center; display: flex; gap: 0.75rem; }
        .az-brand-mark { align-items: center; background: var(--az-fg); border-radius: 0.8rem; color: var(--az-card); display: flex; font-size: 0.75rem; font-weight: 800; height: 2.5rem; justify-content: center; letter-spacing: -0.05em; width: 2.5rem; }
        .az-brand-name { font-size: 0.9rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
        .az-brand-subtitle { color: var(--az-muted-foreground); display: block; font-family: "Geist Mono", ui-monospace, monospace; font-size: 0.64rem; letter-spacing: 0.08em; margin-top: 0.25rem; text-transform: uppercase; }
        .az-top-actions { align-items: center; display: flex; gap: 0.75rem; }
        .az-status { align-items: center; color: var(--az-muted-foreground); display: inline-flex; font-family: "Geist Mono", ui-monospace, monospace; font-size: 0.67rem; gap: 0.45rem; letter-spacing: 0.06em; text-transform: uppercase; }
        .az-status-dot { background: var(--az-primary); border-radius: 999px; box-shadow: 0 0 0 0.25rem rgba(213, 19, 82, 0.12); height: 0.45rem; width: 0.45rem; }
        .az-admin-wrap { position: relative; }
        .az-admin-button { align-items: center; background: rgba(251, 252, 248, 0.8); border: 1px solid var(--az-border); border-radius: 999px; color: var(--az-fg); cursor: pointer; display: inline-flex; height: 2.5rem; justify-content: center; transition: background-color 150ms, border-color 150ms, transform 150ms; width: 2.5rem; }
        .az-admin-button:hover { background: var(--az-card); border-color: var(--az-primary); transform: translateY(-1px); }
        .az-admin-popover { background: var(--az-card); border: 1px solid var(--az-border); border-radius: 0.75rem; box-shadow: var(--az-shadow); font-size: 0.75rem; line-height: 1.4; padding: 0.8rem 0.9rem; position: absolute; right: 0; top: 3rem; width: 15rem; z-index: 3; }
        .az-admin-popover strong { display: block; font-size: 0.8rem; margin-bottom: 0.25rem; }
        .az-admin-popover span { color: var(--az-muted-foreground); display: block; }
        .az-dismiss { background: none; border: 0; color: var(--az-secondary-foreground); cursor: pointer; font-size: 0.72rem; font-weight: 800; margin-top: 0.6rem; padding: 0; }

        .az-content { align-items: stretch; display: grid; gap: clamp(2rem, 7vw, 7rem); grid-template-columns: minmax(0, 0.92fr) minmax(25rem, 1.08fr); margin: clamp(4.5rem, 13vh, 9rem) auto clamp(3.5rem, 10vh, 7rem); max-width: 70rem; }
        .az-intro { align-self: center; max-width: 34rem; padding: 1rem 0; }
        .az-kicker { align-items: center; color: var(--az-primary); display: flex; font-family: "Geist Mono", ui-monospace, monospace; font-size: 0.7rem; font-weight: 700; gap: 0.65rem; letter-spacing: 0.14em; text-transform: uppercase; }
        .az-kicker-line { background: var(--az-primary); height: 1px; width: 2.5rem; }
        .az-hero-title { font-size: clamp(2.8rem, 5.5vw, 5.4rem); font-weight: 800; letter-spacing: -0.075em; line-height: 0.94; margin: 1.4rem 0 0; max-width: 11ch; }
        .az-hero-title span { color: var(--az-primary); display: block; }
        .az-hero-copy { color: var(--az-muted-foreground); font-size: clamp(1rem, 1.45vw, 1.2rem); line-height: 1.6; margin: 1.6rem 0 0; max-width: 29rem; }
        .az-context { align-items: center; border-top: 1px solid var(--az-border); display: flex; gap: 0.9rem; margin-top: 3rem; max-width: 24rem; padding-top: 1.25rem; }
        .az-context-number { color: var(--az-accent); font-family: "Geist Mono", ui-monospace, monospace; font-size: 0.75rem; font-weight: 700; }
        .az-context-copy { display: grid; gap: 0.25rem; }
        .az-context-copy strong { font-size: 0.86rem; }
        .az-context-copy span { color: var(--az-muted-foreground); font-size: 0.78rem; }

        .az-workspace { background: var(--az-sidebar); border-radius: 1.25rem; box-shadow: var(--az-shadow); color: var(--az-sidebar-foreground); padding: clamp(1.25rem, 3vw, 2rem); position: relative; }
        .az-workspace::after { border: 1px solid rgba(248, 245, 238, 0.12); border-radius: 1.25rem; content: ""; inset: 0.5rem; pointer-events: none; position: absolute; }
        .az-workspace-head, .az-workspace-list, .az-workspace-foot { position: relative; z-index: 1; }
        .az-workspace-head { align-items: end; display: flex; justify-content: space-between; margin-bottom: 1.5rem; }
        .az-workspace-eyebrow { color: rgba(248, 245, 238, 0.62); font-family: "Geist Mono", ui-monospace, monospace; font-size: 0.65rem; letter-spacing: 0.13em; text-transform: uppercase; }
        .az-workspace-title { font-size: clamp(1.35rem, 2.2vw, 1.8rem); letter-spacing: -0.04em; line-height: 1.05; margin: 0.4rem 0 0; }
        .az-workspace-count { align-items: center; background: rgba(248, 245, 238, 0.1); border: 1px solid rgba(248, 245, 238, 0.15); border-radius: 999px; color: rgba(248, 245, 238, 0.75); display: inline-flex; font-family: "Geist Mono", ui-monospace, monospace; font-size: 0.65rem; height: 2rem; justify-content: center; width: 2rem; }
        .az-workspace-list { display: grid; gap: 0.7rem; }
        .az-role { align-items: center; background: transparent; border: 1px solid rgba(248, 245, 238, 0.2); border-radius: 0.85rem; color: var(--az-sidebar-foreground); cursor: pointer; display: grid; gap: 0.85rem; grid-template-columns: auto 1fr auto; padding: 1rem; text-align: left; transition: background-color 150ms, border-color 150ms, transform 150ms, box-shadow 150ms; width: 100%; }
        .az-role:hover { background: rgba(248, 245, 238, 0.08); border-color: rgba(248, 245, 238, 0.42); transform: translateX(0.2rem); }
        .az-role.is-selected { background: var(--az-card); border-color: var(--az-card); box-shadow: 0 0.75rem 1.5rem rgba(8, 27, 35, 0.2); color: var(--az-fg); }
        .az-role-icon { align-items: center; background: rgba(248, 245, 238, 0.1); border-radius: 0.65rem; color: var(--az-accent); display: inline-flex; height: 2.75rem; justify-content: center; width: 2.75rem; }
        .az-role.is-selected .az-role-icon { background: var(--az-secondary); color: var(--az-primary); }
        .az-role-copy { min-width: 0; }
        .az-role-eyebrow { color: rgba(248, 245, 238, 0.55); display: block; font-family: "Geist Mono", ui-monospace, monospace; font-size: 0.62rem; letter-spacing: 0.09em; text-transform: uppercase; }
        .az-role.is-selected .az-role-eyebrow { color: var(--az-primary); }
        .az-role-label { display: block; font-size: 1rem; font-weight: 800; margin-top: 0.3rem; }
        .az-role-detail { color: rgba(248, 245, 238, 0.62); display: block; font-size: 0.76rem; margin-top: 0.3rem; }
        .az-role.is-selected .az-role-detail { color: var(--az-muted-foreground); }
        .az-role-arrow { color: rgba(248, 245, 238, 0.55); transition: color 150ms, transform 150ms; }
        .az-role.is-selected .az-role-arrow { color: var(--az-primary); transform: translate(0.15rem, -0.15rem); }
        .az-workspace-foot { align-items: center; border-top: 1px solid rgba(248, 245, 238, 0.15); display: flex; gap: 0.65rem; margin-top: 1.5rem; padding-top: 1.25rem; }
        .az-workspace-foot svg { color: var(--az-accent); flex: 0 0 auto; }
        .az-workspace-foot p { color: rgba(248, 245, 238, 0.68); font-size: 0.75rem; line-height: 1.4; margin: 0; }
        .az-workspace-foot strong { color: var(--az-sidebar-foreground); }
        .az-selection { align-items: center; background: var(--az-secondary); border-radius: 0.65rem; color: var(--az-secondary-foreground); display: flex; font-size: 0.77rem; font-weight: 700; gap: 0.5rem; margin-top: 0.85rem; padding: 0.75rem 0.85rem; }
        .az-selection svg { flex: 0 0 auto; }
        .az-footer { align-items: center; color: var(--az-muted-foreground); display: flex; font-family: "Geist Mono", ui-monospace, monospace; font-size: 0.62rem; justify-content: space-between; letter-spacing: 0.06em; margin: 0 auto; max-width: 70rem; text-transform: uppercase; }
        .az-footer span:last-child { color: var(--az-accent); }

        @media (max-width: 760px) {
          .az-frame { padding: 1rem; }
          .az-status { display: none; }
          .az-content { display: flex; flex-direction: column; gap: 2.25rem; margin: 4rem auto 3.5rem; }
          .az-intro { padding: 0; }
          .az-hero-title { font-size: clamp(3rem, 14vw, 4.6rem); }
          .az-context { margin-top: 2.25rem; }
          .az-workspace { border-radius: 1rem; padding: 1.1rem; }
          .az-workspace::after { border-radius: 1rem; inset: 0.4rem; }
          .az-workspace-head { align-items: start; }
          .az-role { grid-template-columns: auto 1fr auto; padding: 0.85rem; }
          .az-role-detail { line-height: 1.35; }
          .az-footer { align-items: flex-start; flex-direction: column; gap: 0.5rem; }
        }
      `}</style>

      <div className="az-frame">
        <header className="az-topbar">
          <div className="az-brand">
            <span className="az-brand-mark" aria-hidden="true">AZ</span>
            <div>
              <div className="az-brand-name">AdventureZone</div>
              <span className="az-brand-subtitle">Command Terminal</span>
            </div>
          </div>
          <div className="az-top-actions">
            <span className="az-status"><span className="az-status-dot" aria-hidden="true" />System ready</span>
            <div className="az-admin-wrap">
              <button
                aria-expanded={adminOpen}
                aria-label="Administrator Access"
                className="az-admin-button"
                onClick={() => setAdminOpen((open) => !open)}
                title="Administrator Access"
                type="button"
              >
                <Shield aria-hidden="true" size={17} strokeWidth={1.8} />
              </button>
              {adminOpen ? (
                <div className="az-admin-popover" role="status">
                  <strong>Administrator Access</strong>
                  <span>Secure maintenance tools are available from the command terminal.</span>
                  <button className="az-dismiss" onClick={() => setAdminOpen(false)} type="button">Dismiss</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="az-content">
          <section className="az-intro" aria-labelledby="az-title">
            <div className="az-kicker"><span className="az-kicker-line" aria-hidden="true" />Choose your workspace</div>
            <h1 className="az-hero-title" id="az-title">AdventureZone <span>Command Terminal</span></h1>
            <p className="az-hero-copy">Bookings, contacts, routes, and calls all in one place.</p>
            <div className="az-context">
              <span className="az-context-number">00</span>
              <div className="az-context-copy">
                <strong>One command surface</strong>
                <span>Select a role to continue into the right workspace.</span>
              </div>
            </div>
          </section>

          <section className="az-workspace" aria-labelledby="workspace-title">
            <div className="az-workspace-head">
              <div>
                <div className="az-workspace-eyebrow">Access points</div>
                <h2 className="az-workspace-title" id="workspace-title">Enter your workspace</h2>
              </div>
              <span className="az-workspace-count" aria-label="Two workspaces available">02</span>
            </div>
            <div className="az-workspace-list">
              {workspaces.map(({ id, label, detail, eyebrow, icon: Icon }) => {
                const isSelected = selectedWorkspace === id;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={`az-role${isSelected ? " is-selected" : ""}`}
                    key={id}
                    onClick={() => setSelectedWorkspace(id)}
                    type="button"
                  >
                    <span className="az-role-icon"><Icon aria-hidden="true" size={20} strokeWidth={1.8} /></span>
                    <span className="az-role-copy">
                      <span className="az-role-eyebrow">{eyebrow}</span>
                      <span className="az-role-label">{label}</span>
                      <span className="az-role-detail">{detail}</span>
                    </span>
                    <ArrowUpRight aria-hidden="true" className="az-role-arrow" size={18} strokeWidth={1.8} />
                  </button>
                );
              })}
            </div>
            <div className="az-selection" role="status">
              <Sparkles aria-hidden="true" size={15} />
              Ready to continue as {workspaces.find((workspace) => workspace.id === selectedWorkspace)?.label}.
            </div>
            <div className="az-workspace-foot">
              <Zap aria-hidden="true" size={16} />
              <p><strong>AdventureZone Command Terminal</strong> keeps the day’s operational work in one place.</p>
            </div>
          </section>
        </div>

        <footer className="az-footer">
          <span>AdventureZone · Operational workspace</span>
          <span>Secure access</span>
        </footer>
      </div>
    </main>
  );
}