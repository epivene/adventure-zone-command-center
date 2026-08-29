import { useState } from "react";
import { BriefcaseBusiness, Check, MapPinned, Shield, Sparkles, X } from "lucide-react";
import { Link } from "wouter";

import { Card } from "@workspace/avz-crm/components/ui/card";
import { Button } from "@workspace/avz-crm/components/ui/button";

type WorkspaceId = "office" | "manager";

const workspaces: Array<{
  id: WorkspaceId;
  label: string;
  detail: string;
  count: string;
  href: string;
  icon: typeof BriefcaseBusiness;
  tasks: string[];
}> = [
  {
    id: "office",
    label: "Office Coordinator",
    detail: "Bookings, contacts, routes, and calls",
    count: "08",
    href: "/office/sign-in",
    icon: BriefcaseBusiness,
    tasks: ["Confirm Summit Week details", "Call Maya Chen", "Review two route changes"],
  },
  {
    id: "manager",
    label: "Leg Managers",
    detail: "Field-ready operations and trip planning",
    count: "04",
    href: "/manager/sign-in",
    icon: MapPinned,
    tasks: ["Check in for Summit Week", "Review crew assignments", "Capture event notes"],
  },
];

export function CommandTerminalLanding() {
  const [adminOpen, setAdminOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const activeWorkspace = workspaces[0];
  const ActiveIcon = activeWorkspace.icon;

  return (
    <main className="command-terminal-landing">
      <style>{`
        .command-terminal-landing {
          min-height: 100dvh;
          overflow-x: hidden;
          background:
            radial-gradient(circle at 100% 0%, hsl(var(--primary) / .12), transparent 18rem),
            linear-gradient(180deg, hsl(var(--background)), hsl(var(--secondary) / .46));
          color: hsl(var(--foreground));
          font-family: var(--app-font-sans, "DM Sans", ui-sans-serif, system-ui, sans-serif);
        }
        .command-terminal-landing *, .command-terminal-landing *::before, .command-terminal-landing *::after {
          box-sizing: border-box;
        }
        .command-terminal-landing button { font: inherit; }
        .ctl-shell {
          width: min(100% - 1.5rem, 30rem);
          margin: 0 auto;
          padding: .75rem 0 1.25rem;
        }
        .ctl-topbar {
          align-items: center;
          display: flex;
          justify-content: space-between;
          min-height: 2.75rem;
        }
        .ctl-brand {
          align-items: center;
          display: flex;
          gap: .6rem;
          min-width: 0;
        }
        .ctl-brand-mark {
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
        .ctl-brand-name {
          color: hsl(var(--foreground));
          font-size: .83rem;
          font-weight: 800;
          letter-spacing: -.02em;
          line-height: 1.1;
        }
        .ctl-brand-subtitle, .ctl-mono {
          font-family: var(--app-font-mono, "Geist Mono", ui-monospace, monospace);
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .ctl-brand-subtitle {
          color: hsl(var(--muted-foreground));
          display: block;
          font-size: .52rem;
          margin-top: .25rem;
        }
        .ctl-top-actions {
          align-items: center;
          display: flex;
          gap: .5rem;
        }
        .ctl-ready {
          align-items: center;
          color: hsl(var(--muted-foreground));
          display: inline-flex;
          font-size: .55rem;
          gap: .35rem;
        }
        .ctl-ready-dot {
          background: hsl(var(--primary));
          border-radius: 999px;
          box-shadow: 0 0 0 .2rem hsl(var(--primary) / .13);
          display: block;
          height: .4rem;
          width: .4rem;
        }
        .ctl-admin { position: relative; }
        .ctl-admin-panel {
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
        .ctl-admin-panel strong { display: block; font-size: .75rem; }
        .ctl-admin-panel p {
          color: hsl(var(--muted-foreground));
          font-size: .68rem;
          line-height: 1.45;
          margin: .35rem 0 .7rem;
        }
        .ctl-hero {
          border-bottom: 1px solid hsl(var(--border));
          margin-top: 2.5rem;
          padding-bottom: 1.5rem;
        }
        .ctl-kicker {
          color: hsl(var(--primary));
          font-size: .58rem;
          font-weight: 800;
          letter-spacing: .13em;
        }
        .ctl-title {
          color: hsl(var(--foreground));
          font-size: clamp(2rem, 10vw, 2.65rem);
          font-weight: 800;
          letter-spacing: -.06em;
          line-height: 1;
          margin: .55rem 0 0;
          max-width: 14ch;
        }
        .ctl-hero-copy {
          color: hsl(var(--muted-foreground));
          font-size: .76rem;
          line-height: 1.5;
          margin: .65rem 0 0;
          max-width: 28rem;
        }
        .ctl-workspace { margin-top: 1.5rem; }
        .ctl-section-head {
          align-items: end;
          display: flex;
          justify-content: space-between;
          gap: .75rem;
        }
        .ctl-eyebrow {
          color: hsl(var(--muted-foreground));
          font-size: .55rem;
          letter-spacing: .12em;
        }
        .ctl-section-title {
          color: hsl(var(--foreground));
          font-size: 1.02rem;
          font-weight: 800;
          letter-spacing: -.035em;
          margin: .3rem 0 0;
        }
        .ctl-count {
          color: hsl(var(--primary));
          font-size: .56rem;
          font-weight: 800;
          white-space: nowrap;
        }
        .ctl-role-list {
          display: grid;
          gap: .55rem;
          margin-top: .7rem;
        }
        .ctl-role-link {
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
        .ctl-role-icon {
          align-items: center;
          background: hsl(var(--primary-foreground) / .14);
          border-radius: .6rem;
          color: hsl(var(--primary-foreground));
          display: flex;
          height: 2.25rem;
          justify-content: center;
          width: 2.25rem;
        }
        .ctl-role-link[data-active="false"] .ctl-role-icon {
          background: hsl(var(--secondary));
          color: hsl(var(--primary));
        }
        .ctl-role-copy { min-width: 0; }
        .ctl-role-label { display: block; font-size: .8rem; font-weight: 800; }
        .ctl-role-detail {
          color: hsl(var(--primary-foreground) / .75);
          display: block;
          font-size: .63rem;
          line-height: 1.3;
          margin-top: .2rem;
        }
        .ctl-role-link[data-active="false"] .ctl-role-detail { color: hsl(var(--muted-foreground)); }
        .ctl-role-count { color: hsl(var(--primary-foreground)); font-size: .6rem; font-weight: 800; }
        .ctl-role-link[data-active="false"] .ctl-role-count { color: hsl(var(--primary)); }
        .ctl-detail-card { margin-top: .75rem; padding: .9rem; }
        .ctl-detail-intro {
          align-items: start;
          display: flex;
          gap: .65rem;
        }
        .ctl-detail-icon {
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
        .ctl-detail-title {
          color: hsl(var(--foreground));
          font-size: .82rem;
          font-weight: 800;
          margin-top: .38rem;
        }
        .ctl-queue {
          border-top: 1px solid hsl(var(--border));
          display: grid;
          gap: .4rem;
          margin-top: .8rem;
          padding-top: .7rem;
        }
        .ctl-queue-item {
          align-items: center;
          color: hsl(var(--muted-foreground));
          display: flex;
          font-size: .64rem;
          gap: .45rem;
          line-height: 1.25;
        }
        .ctl-queue-item svg { color: hsl(var(--primary)); flex: 0 0 auto; }
        .ctl-actions {
          border-top: 1px solid hsl(var(--border));
          display: grid;
          gap: .5rem;
          margin-top: .8rem;
          padding-top: .8rem;
        }
        .ctl-actions a, .ctl-actions button { width: 100%; }
        .ctl-brief {
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
        @media (max-width: 22rem) {
          .ctl-shell { width: min(100% - 1rem, 30rem); }
          .ctl-ready { display: none; }
        }
      `}</style>

      <div className="ctl-shell">
        <header className="ctl-topbar">
          <div className="ctl-brand">
            <span aria-hidden="true" className="ctl-brand-mark">AZ</span>
            <div>
              <div className="ctl-brand-name">AdventureZone</div>
              <span className="ctl-brand-subtitle">Command Terminal</span>
            </div>
          </div>
          <div className="ctl-top-actions">
            <span className="ctl-ready">
              <span aria-hidden="true" className="ctl-ready-dot" />
              System ready
            </span>
            <div className="ctl-admin">
              <Button
                aria-expanded={adminOpen}
                aria-label="Open administrator access"
                onClick={() => setAdminOpen((open) => !open)}
                size="icon"
                title="Administrator access"
                variant="outline"
              >
                {adminOpen ? <X aria-hidden="true" size={16} strokeWidth={1.8} /> : <Shield aria-hidden="true" size={16} strokeWidth={1.8} />}
              </Button>
              {adminOpen ? (
                <Card className="ctl-admin-panel" role="status">
                  <strong>Administrator access</strong>
                  <p>Secure maintenance tools are available from the command terminal.</p>
                  <Button onClick={() => setAdminOpen(false)} size="sm" variant="link">Dismiss</Button>
                </Card>
              ) : null}
            </div>
          </div>
        </header>

        <section aria-labelledby="command-terminal-title" className="ctl-hero">
          <div className="ctl-kicker ctl-mono">AdventureZone / Command terminal</div>
          <h1 className="ctl-title" id="command-terminal-title">Choose your workspace</h1>
          <p className="ctl-hero-copy">Start with the workspace that matches your day.</p>
        </section>

        <section aria-labelledby="workspace-title" className="ctl-workspace">
          <div className="ctl-section-head">
            <div>
              <div className="ctl-eyebrow ctl-mono">Access points</div>
              <h2 className="ctl-section-title" id="workspace-title">Select a workspace</h2>
            </div>
            <span aria-label="Two workspaces available" className="ctl-count ctl-mono">02</span>
          </div>

          <div aria-label="Workspace selection" className="ctl-role-list">
            {workspaces.map(({ id, label, detail, count, href, icon: Icon }) => {
              const active = id === activeWorkspace.id;
              return (
                <Button asChild className="ctl-role-link" data-active={active} key={id} variant={active ? "default" : "outline"}>
                  <Link href={href}>
                    <span className="ctl-role-icon"><Icon aria-hidden="true" size={18} strokeWidth={1.8} /></span>
                    <span className="ctl-role-copy">
                      <span className="ctl-role-label">{label}</span>
                      <span className="ctl-role-detail">{detail}</span>
                    </span>
                    <span className="ctl-role-count ctl-mono">{count}</span>
                  </Link>
                </Button>
              );
            })}
          </div>

          <Card className="ctl-detail-card">
            <div className="ctl-detail-intro">
              <span className="ctl-detail-icon"><ActiveIcon aria-hidden="true" size={16} strokeWidth={1.8} /></span>
              <div>
                <div className="ctl-eyebrow ctl-mono">Office workspace</div>
                <h3 className="ctl-detail-title">Today’s focus</h3>
              </div>
            </div>
            <div aria-label={`${activeWorkspace.label} ready items`} className="ctl-queue">
              {activeWorkspace.tasks.map((task) => (
                <div className="ctl-queue-item" key={task}><Check aria-hidden="true" size={13} strokeWidth={2.3} />{task}</div>
              ))}
            </div>
            <div className="ctl-actions">
              <Button asChild>
                <Link href={activeWorkspace.href}>Continue to Office <span aria-hidden="true">→</span></Link>
              </Button>
              <Button onClick={() => setBriefOpen((open) => !open)} type="button" variant="secondary">
                <Sparkles aria-hidden="true" size={15} />
                {briefOpen ? "Hide workspace brief" : "View workspace brief"}
              </Button>
            </div>
          </Card>

          {briefOpen ? (
            <div className="ctl-brief" role="status">
              <Sparkles aria-hidden="true" size={14} />
              Office workspace keeps the day moving from booking confirmation through route readiness.
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}