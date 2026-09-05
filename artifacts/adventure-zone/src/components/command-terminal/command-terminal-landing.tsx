import { BriefcaseBusiness, Briefcase, MapPinned, Shield } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@workspace/avz-crm/components/ui/button";

const workspaces: Array<{
  label: string;
  detail: string;
  href: string;
  icon: typeof BriefcaseBusiness;
}> = [
  {
    label: "Boss",
    detail: "Bookings, schedule, assignments, and design",
    href: "/boss/sign-in",
    icon: Briefcase,
  },
  {
    label: "Office Coordinator",
    detail: "Bookings, contacts, routes, and calls",
    href: "/office/sign-in",
    icon: BriefcaseBusiness,
  },
  {
    label: "Leg Managers",
    detail: "Field-ready operations and trip planning",
    href: "/manager/sign-in",
    icon: MapPinned,
  },
];

const logoSrc = `${import.meta.env.BASE_URL}adventure-zone-logo.png`;

export function CommandTerminalLanding() {
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
          width: min(100% - 1rem, 30rem);
          margin: 0 auto;
          padding: .6rem 0 1rem;
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
          min-width: 0;
        }
        .ctl-brand-logo {
          display: block;
          height: auto;
          width: clamp(7.5rem, 32vw, 9.25rem);
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
        .ctl-hero {
          border-bottom: 2px solid hsl(var(--foreground));
          margin-top: 2rem;
          padding-bottom: 1.2rem;
        }
        .ctl-kicker {
          color: hsl(var(--primary));
          font-size: .58rem;
          font-weight: 800;
          letter-spacing: .13em;
        }
        .ctl-title {
          color: hsl(var(--foreground));
          font-family: var(--app-font-display, Impact, "Arial Narrow Bold", sans-serif);
          font-size: clamp(1.7rem, 8vw, 2.2rem);
          font-weight: 800;
          letter-spacing: .015em;
          line-height: 1;
          margin: .55rem 0 0;
          max-width: 14ch;
          text-transform: uppercase;
        }
        .ctl-workspace { margin-top: 1.2rem; }
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
          font-family: var(--app-font-display, Impact, "Arial Narrow Bold", sans-serif);
          font-size: 1.02rem;
          font-weight: 800;
          letter-spacing: .02em;
          margin: .3rem 0 0;
          text-transform: uppercase;
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
          grid-template-columns: 2.25rem minmax(0, 1fr);
          justify-content: start;
           min-height: 3.8rem;
           padding: .55rem;
          text-align: left;
          width: 100%;
        }
        .ctl-role-icon {
          align-items: center;
          background: hsl(var(--primary-foreground) / .14);
          border-radius: .6rem;
          color: hsl(var(--primary-foreground));
          display: flex;
           height: 2rem;
          justify-content: center;
           width: 2rem;
        }
        .ctl-role-link[data-active="false"] .ctl-role-icon {
          background: hsl(var(--secondary));
          color: hsl(var(--primary));
        }
        .ctl-role-copy { min-width: 0; }
        .ctl-role-label { display: block; font-size: .74rem; font-weight: 800; }
        .ctl-role-detail {
          color: hsl(var(--primary-foreground) / .75);
          display: block;
           font-size: .58rem;
          line-height: 1.3;
          margin-top: .2rem;
        }
        .ctl-role-link[data-active="false"] .ctl-role-detail { color: hsl(var(--muted-foreground)); }
        .ctl-role-link[data-active="false"] { box-shadow: 3px 3px 0 hsl(var(--accent)); }
        .ctl-role-label {
          font-family: var(--app-font-display, Impact, "Arial Narrow Bold", sans-serif);
          letter-spacing: .02em;
          text-transform: uppercase;
        }
        @media (max-width: 22rem) {
          .ctl-shell { width: min(100% - 1rem, 30rem); }
          .ctl-ready { display: none; }
        }
      `}</style>

      <div className="ctl-shell">
        <header className="ctl-topbar">
          <div className="ctl-brand">
            <div>
              <img alt="The Adventure Zone" className="ctl-brand-logo" src={logoSrc} />
              <span className="ctl-brand-subtitle">Command Terminal</span>
            </div>
          </div>
          <div className="ctl-top-actions">
            <span className="ctl-ready">
              <span aria-hidden="true" className="ctl-ready-dot" />
              System ready
            </span>
            <Button asChild aria-label="Administrator Access" size="icon" title="Administrator Access" variant="outline">
              <Link href="/sign-in"><Shield aria-hidden="true" size={16} strokeWidth={1.8} /></Link>
            </Button>
          </div>
        </header>

        <section aria-labelledby="command-terminal-title" className="ctl-hero">
          <div className="ctl-kicker ctl-mono">Command terminal / workspace access</div>
          <h1 className="ctl-title" id="command-terminal-title">Choose your workspace</h1>
        </section>

        <section aria-labelledby="workspace-title" className="ctl-workspace">
          <div className="ctl-section-head">
            <div>
              <div className="ctl-eyebrow ctl-mono">Access points</div>
              <h2 className="ctl-section-title" id="workspace-title">Select a workspace</h2>
            </div>
          </div>

          <div aria-label="Workspace selection" className="ctl-role-list">
            {workspaces.map(({ label, detail, href, icon: Icon }) => {
              return (
                <Button asChild className="ctl-role-link" data-active={label === "Boss"} key={label} variant={label === "Boss" ? "default" : "outline"}>
                  <Link href={href}>
                    <span className="ctl-role-icon"><Icon aria-hidden="true" size={18} strokeWidth={1.8} /></span>
                    <span className="ctl-role-copy">
                      <span className="ctl-role-label">{label}</span>
                      <span className="ctl-role-detail">{detail}</span>
                    </span>
                  </Link>
                </Button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}