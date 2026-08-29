import "@workspace/avz-crm/styles.css";
import { useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CircleHelp,
  MapPinned,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card } from "@workspace/avz-crm/components/ui/card";

type WorkspaceId = "office" | "manager";

const workspaces: Array<{
  id: WorkspaceId;
  label: string;
  shortLabel: string;
  detail: string;
  icon: typeof BriefcaseBusiness;
  count: string;
  queue: string[];
}> = [
  {
    id: "office",
    label: "Office Coordinator",
    shortLabel: "Office",
    detail: "Bookings, contacts, routes, and calls",
    icon: BriefcaseBusiness,
    count: "08",
    queue: ["Confirm Summit Week details", "Call Maya Chen", "Review two route changes"],
  },
  {
    id: "manager",
    label: "Leg Managers",
    shortLabel: "Field",
    detail: "Field-ready operations and trip planning",
    icon: MapPinned,
    count: "04",
    queue: ["Check in for Summit Week", "Review crew assignments", "Capture event notes"],
  },
];

export function MobileCommandCenter() {
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceId>("office");
  const [adminOpen, setAdminOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspace) ?? workspaces[0];
  const ActiveIcon = activeWorkspace.icon;

  const chooseWorkspace = (id: WorkspaceId) => {
    setSelectedWorkspace(id);
    setActionMessage("");
  };

  return (
    <main className="mobile-command">
      <style>{`
        .mobile-command {
          min-height: 100dvh;
          overflow-x: hidden;
          background:
            radial-gradient(circle at 100% 0%, hsl(var(--primary) / .12), transparent 18rem),
            linear-gradient(180deg, hsl(var(--background)), hsl(var(--secondary) / .46));
          color: hsl(var(--foreground));
          font-family: var(--app-font-sans, "DM Sans", ui-sans-serif, system-ui, sans-serif);
        }
        .mobile-command *, .mobile-command *::before, .mobile-command *::after {
          box-sizing: border-box;
        }
        .mobile-command button { font: inherit; }
        .mc-shell {
          width: min(100% - 1.5rem, 30rem);
          margin: 0 auto;
          padding: .75rem 0 1.25rem;
        }
        .mc-topbar {
          align-items: center;
          display: flex;
          justify-content: space-between;
          min-height: 2.75rem;
        }
        .mc-brand {
          align-items: center;
          display: flex;
          gap: .6rem;
          min-width: 0;
        }
        .mc-brand-mark {
          align-items: center;
          background: hsl(var(--sidebar));
          border-radius: .65rem;
          color: hsl(var(--sidebar-foreground));
          display: flex;
          flex: 0 0 auto;
          font-size: .7rem;
          font-weight: 800;
          height: 2.25rem;
          justify-content: center;
          letter-spacing: -.04em;
          width: 2.25rem;
        }
        .mc-brand-name {
          color: hsl(var(--foreground));
          font-size: .83rem;
          font-weight: 800;
          letter-spacing: -.02em;
          line-height: 1.1;
        }
        .mc-brand-subtitle, .mc-mono {
          font-family: var(--app-font-mono, "Geist Mono", ui-monospace, monospace);
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .mc-brand-subtitle {
          color: hsl(var(--muted-foreground));
          display: block;
          font-size: .52rem;
          margin-top: .25rem;
        }
        .mc-top-actions {
          align-items: center;
          display: flex;
          gap: .5rem;
        }
        .mc-ready {
          align-items: center;
          color: hsl(var(--muted-foreground));
          display: inline-flex;
          font-size: .55rem;
          gap: .35rem;
        }
        .mc-ready-dot {
          background: hsl(var(--primary));
          border-radius: 999px;
          box-shadow: 0 0 0 .2rem hsl(var(--primary) / .13);
          display: block;
          height: .4rem;
          width: .4rem;
        }
        .mc-admin {
          position: relative;
        }
        .mc-admin-panel {
          background: hsl(var(--popover));
          border: 1px solid hsl(var(--border));
          border-radius: .75rem;
          box-shadow: 0 .75rem 2rem hsl(var(--foreground) / .12);
          color: hsl(var(--popover-foreground));
          padding: .85rem;
          position: absolute;
          right: 0;
          top: 3rem;
          width: min(15rem, calc(100vw - 2rem));
          z-index: 5;
        }
        .mc-admin-panel strong {
          display: block;
          font-size: .75rem;
        }
        .mc-admin-panel p {
          color: hsl(var(--muted-foreground));
          font-size: .68rem;
          line-height: 1.45;
          margin: .35rem 0 .7rem;
        }
        .mc-hero {
          border-bottom: 1px solid hsl(var(--border));
          margin-top: 2rem;
          padding-bottom: 1.25rem;
        }
        .mc-kicker {
          color: hsl(var(--primary));
          font-size: .58rem;
          font-weight: 800;
          letter-spacing: .13em;
        }
        .mc-title {
          color: hsl(var(--foreground));
          font-size: clamp(2.25rem, 12vw, 3.2rem);
          font-weight: 800;
          letter-spacing: -.075em;
          line-height: .93;
          margin: .55rem 0 0;
          max-width: 9ch;
        }
        .mc-title em {
          color: hsl(var(--primary));
          font-style: normal;
        }
        .mc-hero-copy {
          color: hsl(var(--muted-foreground));
          font-size: .76rem;
          line-height: 1.5;
          margin: .85rem 0 0;
          max-width: 28rem;
        }
        .mc-surface-row {
          display: grid;
          gap: .5rem;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          margin-top: 1rem;
        }
        .mc-surface {
          background: hsl(var(--card) / .74);
          border: 1px solid hsl(var(--border));
          border-radius: .6rem;
          min-width: 0;
          padding: .55rem .6rem;
        }
        .mc-surface-index {
          color: hsl(var(--accent));
          display: block;
          font-size: .52rem;
          font-weight: 800;
        }
        .mc-surface-label {
          color: hsl(var(--foreground));
          display: block;
          font-size: .62rem;
          font-weight: 800;
          line-height: 1.2;
          margin-top: .25rem;
        }
        .mc-workspace {
          margin-top: 1.25rem;
        }
        .mc-section-head {
          align-items: end;
          display: flex;
          justify-content: space-between;
          gap: .75rem;
        }
        .mc-eyebrow {
          color: hsl(var(--muted-foreground));
          font-size: .55rem;
          letter-spacing: .12em;
        }
        .mc-section-title {
          color: hsl(var(--foreground));
          font-size: 1.02rem;
          font-weight: 800;
          letter-spacing: -.035em;
          margin: .3rem 0 0;
        }
        .mc-count {
          color: hsl(var(--primary));
          font-size: .56rem;
          font-weight: 800;
          white-space: nowrap;
        }
        .mc-role-list {
          display: grid;
          gap: .55rem;
          margin-top: .7rem;
        }
        .mc-role-button {
          align-items: center;
          display: grid;
          gap: .7rem;
          grid-template-columns: 2.25rem minmax(0, 1fr) auto;
          justify-content: start;
          min-height: 4.25rem;
          padding: .7rem;
          text-align: left;
          width: 100%;
        }
        .mc-role-icon {
          align-items: center;
          background: hsl(var(--secondary));
          border-radius: .6rem;
          color: hsl(var(--primary));
          display: flex;
          height: 2.25rem;
          justify-content: center;
          width: 2.25rem;
        }
        .mc-role-button[data-active="true"] .mc-role-icon {
          background: hsl(var(--primary-foreground) / .14);
          color: hsl(var(--primary-foreground));
        }
        .mc-role-copy { min-width: 0; }
        .mc-role-label {
          display: block;
          font-size: .8rem;
          font-weight: 800;
        }
        .mc-role-detail {
          color: hsl(var(--muted-foreground));
          display: block;
          font-size: .63rem;
          line-height: 1.3;
          margin-top: .2rem;
        }
        .mc-role-button[data-active="true"] .mc-role-detail {
          color: hsl(var(--primary-foreground) / .75);
        }
        .mc-role-count {
          color: hsl(var(--primary));
          font-size: .6rem;
          font-weight: 800;
        }
        .mc-role-button[data-active="true"] .mc-role-count {
          color: hsl(var(--primary-foreground));
        }
        .mc-detail-card {
          margin-top: .75rem;
          padding: .9rem;
        }
        .mc-detail-intro {
          align-items: start;
          display: flex;
          gap: .65rem;
        }
        .mc-detail-icon {
          align-items: center;
          background: hsl(var(--secondary));
          border-radius: .55rem;
          color: hsl(var(--primary));
          display: flex;
          flex: 0 0 auto;
          height: 2rem;
          justify-content: center;
          width: 2rem;
        }
        .mc-detail-copy-wrap { min-width: 0; }
        .mc-detail-title {
          color: hsl(var(--foreground));
          font-size: .82rem;
          font-weight: 800;
          margin-top: .38rem;
        }
        .mc-detail-copy {
          color: hsl(var(--muted-foreground));
          font-size: .64rem;
          line-height: 1.4;
          margin-top: .2rem;
        }
        .mc-queue {
          border-top: 1px solid hsl(var(--border));
          display: grid;
          gap: .4rem;
          margin-top: .8rem;
          padding-top: .7rem;
        }
        .mc-queue-item {
          align-items: center;
          color: hsl(var(--muted-foreground));
          display: flex;
          font-size: .64rem;
          gap: .45rem;
          line-height: 1.25;
        }
        .mc-queue-item svg {
          color: hsl(var(--primary));
          flex: 0 0 auto;
        }
        .mc-actions {
          border-top: 1px solid hsl(var(--border));
          display: grid;
          gap: .5rem;
          margin-top: .8rem;
          padding-top: .8rem;
        }
        .mc-actions button { width: 100%; }
        .mc-action-message {
          align-items: flex-start;
          background: hsl(var(--secondary));
          border: 1px solid hsl(var(--border));
          border-radius: .6rem;
          color: hsl(var(--secondary-foreground));
          display: flex;
          font-size: .64rem;
          font-weight: 700;
          gap: .4rem;
          line-height: 1.35;
          margin-top: .6rem;
          padding: .62rem .7rem;
        }
        .mc-footer {
          align-items: center;
          color: hsl(var(--muted-foreground));
          display: flex;
          font-size: .53rem;
          justify-content: space-between;
          letter-spacing: .06em;
          margin-top: 1.15rem;
          text-transform: uppercase;
        }
        .mc-footer strong {
          align-items: center;
          color: hsl(var(--primary));
          display: inline-flex;
          gap: .25rem;
          font-weight: 800;
        }
        @media (max-width: 22rem) {
          .mc-shell { width: min(100% - 1rem, 30rem); }
          .mc-ready { display: none; }
          .mc-surface-row { gap: .35rem; }
          .mc-surface { padding-inline: .45rem; }
          .mc-surface-label { font-size: .57rem; }
        }
      `}</style>

      <div className="mc-shell">
        <header className="mc-topbar">
          <div className="mc-brand">
            <span aria-hidden="true" className="mc-brand-mark">AZ</span>
            <div>
              <div className="mc-brand-name">AdventureZone</div>
              <span className="mc-brand-subtitle">Command Terminal</span>
            </div>
          </div>
          <div className="mc-top-actions">
            <span className="mc-ready">
              <span aria-hidden="true" className="mc-ready-dot" />
              System ready
            </span>
            <div className="mc-admin">
              <Button
                aria-expanded={adminOpen}
                aria-label="Open administrator access"
                onClick={() => setAdminOpen((open) => !open)}
                size="icon"
                title="Administrator access"
                variant="outline"
              >
                {adminOpen ? (
                  <X aria-hidden="true" size={16} strokeWidth={1.8} />
                ) : (
                  <Shield aria-hidden="true" size={16} strokeWidth={1.8} />
                )}
              </Button>
              {adminOpen ? (
                <Card className="mc-admin-panel" role="status">
                  <strong>Administrator access</strong>
                  <p>Secure maintenance tools are available from the command terminal.</p>
                  <Button onClick={() => setAdminOpen(false)} size="sm" variant="link">Dismiss</Button>
                </Card>
              ) : null}
            </div>
          </div>
        </header>

        <section aria-labelledby="mobile-command-title" className="mc-hero">
          <div className="mc-kicker mc-mono">Choose your workspace</div>
          <h1 className="mc-title" id="mobile-command-title">
            AdventureZone <em>Command Terminal</em>
          </h1>
          <p className="mc-hero-copy">
            Move bookings, contacts, routes, and calls forward from the right workspace.
          </p>
          <div aria-label="Command surface areas" className="mc-surface-row">
            <div className="mc-surface">
              <span className="mc-surface-index mc-mono">01</span>
              <span className="mc-surface-label">Bookings</span>
            </div>
            <div className="mc-surface">
              <span className="mc-surface-index mc-mono">02</span>
              <span className="mc-surface-label">Contacts</span>
            </div>
            <div className="mc-surface">
              <span className="mc-surface-index mc-mono">03</span>
              <span className="mc-surface-label">Routes & calls</span>
            </div>
          </div>
        </section>

        <section aria-labelledby="mobile-workspace-title" className="mc-workspace">
          <div className="mc-section-head">
            <div>
              <div className="mc-eyebrow mc-mono">Access points</div>
              <h2 className="mc-section-title" id="mobile-workspace-title">Enter your workspace</h2>
            </div>
            <span aria-label="Two workspaces available" className="mc-count mc-mono">02 available</span>
          </div>

          <div aria-label="Workspace selection" className="mc-role-list" role="tablist">
            {workspaces.map(({ id, label, detail, count, icon: Icon }) => {
              const active = selectedWorkspace === id;
              return (
                <Button
                  aria-selected={active}
                  className="mc-role-button"
                  data-active={active}
                  key={id}
                  onClick={() => chooseWorkspace(id)}
                  role="tab"
                  variant={active ? "default" : "outline"}
                >
                  <span className="mc-role-icon">
                    <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                  </span>
                  <span className="mc-role-copy">
                    <span className="mc-role-label">{label}</span>
                    <span className="mc-role-detail">{detail}</span>
                  </span>
                  <span className="mc-role-count mc-mono">{count}</span>
                </Button>
              );
            })}
          </div>

          <Card className="mc-detail-card">
            <div className="mc-detail-intro">
              <span className="mc-detail-icon">
                <ActiveIcon aria-hidden="true" size={16} strokeWidth={1.8} />
              </span>
              <div className="mc-detail-copy-wrap">
                <Badge variant="secondary">{activeWorkspace.shortLabel} workspace selected</Badge>
                <h3 className="mc-detail-title">{activeWorkspace.label}</h3>
                <p className="mc-detail-copy">
                  Your next useful actions are grouped here so the day can move forward without extra searching.
                </p>
              </div>
            </div>
            <div aria-label={`${activeWorkspace.label} ready items`} className="mc-queue">
              {activeWorkspace.queue.map((item) => (
                <div className="mc-queue-item" key={item}>
                  <Check aria-hidden="true" size={13} strokeWidth={2.3} />
                  {item}
                </div>
              ))}
            </div>
            <div className="mc-actions">
              <Button onClick={() => setActionMessage(`Opening ${activeWorkspace.label}.`)} type="button">
                Continue to {activeWorkspace.shortLabel}
                <ArrowRight aria-hidden="true" size={15} />
              </Button>
              <Button onClick={() => setActionMessage("Workspace brief is ready to review.")} type="button" variant="secondary">
                <Sparkles aria-hidden="true" size={15} />
                View workspace brief
              </Button>
            </div>
          </Card>

          {actionMessage ? (
            <div className="mc-action-message" role="status">
              <Sparkles aria-hidden="true" size={14} />
              {actionMessage}
            </div>
          ) : null}
        </section>

        <footer className="mc-footer">
          <span>AdventureZone · Operational workspace</span>
          <strong><CircleHelp aria-hidden="true" size={12} /> Help nearby</strong>
        </footer>
      </div>
    </main>
  );
}