import "@workspace/avz-crm/styles.css";
import { BriefcaseBusiness, MapPinned, Shield } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";

const workspaces: Array<{
  label: string;
  detail: string;
  icon: typeof BriefcaseBusiness;
  href: string;
}> = [
  {
    label: "Office Coordinator",
    detail: "Bookings, contacts, routes, and calls",
    icon: BriefcaseBusiness,
    href: "/office/sign-in",
  },
  {
    label: "Leg Managers",
    detail: "Field-ready operations and trip planning",
    icon: MapPinned,
    href: "/manager/sign-in",
  },
];

export function MobileCommandCenter() {
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
        .mc-hero {
          border-bottom: 1px solid hsl(var(--border));
          margin-top: 2.5rem;
          padding-bottom: 1.5rem;
        }
        .mc-kicker {
          color: hsl(var(--primary));
          font-size: .58rem;
          font-weight: 800;
          letter-spacing: .13em;
        }
        .mc-title {
          color: hsl(var(--foreground));
          font-size: clamp(2rem, 10vw, 2.65rem);
          font-weight: 800;
          letter-spacing: -.06em;
          line-height: 1;
          margin: .55rem 0 0;
          max-width: 14ch;
        }
        .mc-workspace {
          margin-top: 1.5rem;
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
        .mc-role-list {
          display: grid;
          gap: .55rem;
          margin-top: .7rem;
        }
        .mc-role-button {
          align-items: center;
          display: grid;
          gap: .7rem;
          grid-template-columns: 2.25rem minmax(0, 1fr);
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
            <Button asChild aria-label="Administrator Access" size="icon" title="Administrator Access" variant="outline">
              <a href="/sign-in"><Shield aria-hidden="true" size={16} strokeWidth={1.8} /></a>
            </Button>
          </div>
        </header>

        <section aria-labelledby="mobile-command-title" className="mc-hero">
          <div className="mc-kicker mc-mono">AdventureZone / Command terminal</div>
          <h1 className="mc-title" id="mobile-command-title">Choose your workspace</h1>
        </section>

        <section aria-labelledby="mobile-workspace-title" className="mc-workspace">
          <div className="mc-section-head">
            <div>
              <div className="mc-eyebrow mc-mono">Access points</div>
              <h2 className="mc-section-title" id="mobile-workspace-title">Select a workspace</h2>
            </div>
          </div>

          <div aria-label="Workspace selection" className="mc-role-list" role="tablist">
            {workspaces.map(({ id, label, detail, icon: Icon }) => {
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
                <div className="mc-eyebrow mc-mono">{activeWorkspace.shortLabel} workspace</div>
                <h3 className="mc-detail-title">Today’s focus</h3>
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
            </div>
          </Card>

          {actionMessage ? (
            <div className="mc-action-message" role="status">
              <Sparkles aria-hidden="true" size={14} />
              {actionMessage}
            </div>
          ) : null}
        </section>

      </div>
    </main>
  );
}