import { useState, type CSSProperties } from "react";
import { ArrowRight, BriefcaseBusiness, Check, CircleHelp, MapPinned, Shield, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

export function StackedCommand() {
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceId>("office");
  const [adminOpen, setAdminOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  const activeWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspace) ?? workspaces[0];
  const ActiveIcon = activeWorkspace.icon;

  const chooseWorkspace = (id: WorkspaceId) => {
    setSelectedWorkspace(id);
    setActionMessage("");
  };

  return (
    <main
      className="stacked-command"
      style={
        {
          "--sc-bg": "#f3f5f0",
          "--sc-fg": "#173b48",
          "--sc-card": "#fbfcf8",
          "--sc-border": "#d8e2dd",
          "--sc-muted": "#71848a",
          "--sc-primary": "#d51352",
          "--sc-primary-foreground": "#fff7fa",
          "--sc-secondary": "#fde7ef",
          "--sc-secondary-foreground": "#8e123f",
          "--sc-accent": "#d4874f",
          "--sc-sidebar": "#173b48",
          "--sc-sidebar-foreground": "#f8f5ee",
          "--sc-shadow": "0 24px 64px rgba(23, 59, 72, 0.12)",
        } as CSSProperties
      }
    >
      <style>{`
        .stacked-command {
          min-height: 100dvh;
          overflow-x: hidden;
          background:
            radial-gradient(circle at 100% 0%, rgba(213, 19, 82, .08), transparent 26rem),
            radial-gradient(circle at 0% 100%, rgba(212, 135, 79, .11), transparent 28rem),
            var(--sc-bg);
          color: var(--sc-fg);
          font-family: var(--app-font-sans, "DM Sans", ui-sans-serif, system-ui, sans-serif);
        }
        .stacked-command *, .stacked-command *::before, .stacked-command *::after { box-sizing: border-box; }
        .stacked-command button { font: inherit; }
        .sc-frame { width: min(100% - 2rem, 76rem); margin: 0 auto; padding: 1rem 0 1.5rem; position: relative; z-index: 1; }
        .sc-header { align-items: center; display: flex; justify-content: space-between; gap: 1rem; min-height: 3rem; }
        .sc-brand { align-items: center; display: flex; gap: .7rem; min-width: 0; }
        .sc-brand-mark { align-items: center; background: var(--sc-sidebar); border-radius: .7rem; color: var(--sc-sidebar-foreground); display: flex; flex: 0 0 auto; font-size: .75rem; font-weight: 800; height: 2.4rem; justify-content: center; letter-spacing: -.04em; width: 2.4rem; }
        .sc-brand-name { color: var(--sc-fg); font-size: .9rem; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; }
        .sc-brand-subtitle { color: var(--sc-muted); display: block; font-family: "Geist Mono", ui-monospace, monospace; font-size: .58rem; letter-spacing: .1em; margin-top: .28rem; text-transform: uppercase; }
        .sc-header-actions { align-items: center; display: flex; gap: .75rem; }
        .sc-status { align-items: center; color: var(--sc-muted); display: inline-flex; font-family: "Geist Mono", ui-monospace, monospace; font-size: .61rem; gap: .4rem; letter-spacing: .08em; text-transform: uppercase; }
        .sc-status-dot { background: var(--sc-primary); border-radius: 999px; box-shadow: 0 0 0 .25rem rgba(213, 19, 82, .12); height: .42rem; width: .42rem; }
        .sc-admin-wrap { position: relative; }
        .sc-admin-popover { background: var(--sc-card); border: 1px solid var(--sc-border); border-radius: .75rem; box-shadow: var(--sc-shadow); color: var(--sc-fg); padding: .9rem; position: absolute; right: 0; top: 3rem; width: 16rem; z-index: 4; }
        .sc-admin-popover strong { display: block; font-size: .78rem; }
        .sc-admin-popover p { color: var(--sc-muted); font-size: .7rem; line-height: 1.45; margin: .35rem 0 .75rem; }

        .sc-hero { border-bottom: 1px solid var(--sc-border); margin-top: clamp(3rem, 9vh, 6.5rem); padding-bottom: 2.25rem; }
        .sc-hero-kicker { align-items: center; color: var(--sc-primary); display: flex; font-family: "Geist Mono", ui-monospace, monospace; font-size: .62rem; font-weight: 700; gap: .55rem; letter-spacing: .12em; text-transform: uppercase; }
        .sc-hero-kicker::before { background: var(--sc-primary); content: ""; height: 1px; width: 2rem; }
        .sc-hero-row { align-items: end; display: flex; gap: 2rem; justify-content: space-between; margin-top: .9rem; }
        .sc-title { color: var(--sc-fg); font-size: clamp(2.5rem, 7vw, 5rem); font-weight: 800; letter-spacing: -.075em; line-height: .94; margin: 0; max-width: 11ch; }
        .sc-title em { color: var(--sc-primary); font-style: normal; }
        .sc-hero-copy { color: var(--sc-muted); font-size: .85rem; line-height: 1.55; margin: 0 0 .35rem; max-width: 25rem; }

        .sc-domain-strip { align-items: stretch; display: grid; gap: 1px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 1.75rem; overflow: hidden; }
        .sc-domain { background: var(--sc-card); border: 1px solid var(--sc-border); display: grid; gap: .45rem; padding: .9rem 1rem; }
        .sc-domain:first-child { border-radius: .75rem 0 0 .75rem; }
        .sc-domain:last-child { border-radius: 0 .75rem .75rem 0; }
        .sc-domain-label { color: var(--sc-fg); font-size: .72rem; font-weight: 800; }
        .sc-domain-detail { color: var(--sc-muted); font-size: .64rem; line-height: 1.35; }
        .sc-domain-index { color: var(--sc-accent); font-family: "Geist Mono", ui-monospace, monospace; font-size: .6rem; font-weight: 700; letter-spacing: .08em; }

        .sc-workspace-section { margin-top: 2rem; }
        .sc-section-heading { align-items: end; display: flex; justify-content: space-between; gap: 1rem; }
        .sc-eyebrow { color: var(--sc-muted); font-family: "Geist Mono", ui-monospace, monospace; font-size: .6rem; letter-spacing: .11em; text-transform: uppercase; }
        .sc-section-title { color: var(--sc-fg); font-size: 1.15rem; font-weight: 800; letter-spacing: -.03em; margin: .35rem 0 0; }
        .sc-count { color: var(--sc-primary); font-family: "Geist Mono", ui-monospace, monospace; font-size: .68rem; font-weight: 800; }
        .sc-workspace-tabs { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: .9rem; }
        .sc-workspace-tab { align-items: start; background: var(--sc-card); border-color: var(--sc-border); color: var(--sc-fg); display: grid; gap: .85rem; grid-template-columns: 2.5rem minmax(0, 1fr) auto; justify-content: start; min-height: 7rem; padding: 1rem; text-align: left; width: 100%; }
        .sc-workspace-tab:hover { border-color: var(--sc-primary); }
        .sc-workspace-tab-active, .sc-workspace-tab[data-active="true"] { background: var(--sc-sidebar); border-color: var(--sc-sidebar); box-shadow: var(--sc-shadow); color: var(--sc-sidebar-foreground); }
        .sc-tab-icon { align-items: center; background: var(--sc-secondary); border-radius: .65rem; color: var(--sc-primary); display: flex; height: 2.5rem; justify-content: center; width: 2.5rem; }
        .sc-workspace-tab[data-active="true"] .sc-tab-icon { background: rgba(248, 245, 238, .12); color: var(--sc-accent); }
        .sc-tab-copy { min-width: 0; }
        .sc-tab-label { display: block; font-size: .88rem; font-weight: 800; }
        .sc-tab-detail { color: var(--sc-muted); display: block; font-size: .68rem; line-height: 1.4; margin-top: .35rem; }
        .sc-workspace-tab[data-active="true"] .sc-tab-detail { color: rgba(248, 245, 238, .62); }
        .sc-tab-count { color: var(--sc-primary); font-family: "Geist Mono", ui-monospace, monospace; font-size: .65rem; font-weight: 800; }
        .sc-workspace-tab[data-active="true"] .sc-tab-count { color: var(--sc-accent); }

        .sc-detail-card { align-items: stretch; background: var(--sc-card); border: 1px solid var(--sc-border); border-radius: .9rem; box-shadow: 0 .75rem 2rem rgba(32, 71, 77, .04); display: grid; gap: 1.25rem; grid-template-columns: minmax(0, 1.1fr) minmax(15rem, .9fr); margin-top: .75rem; padding: 1.25rem; }
        .sc-detail-intro { align-items: start; display: flex; gap: .75rem; }
        .sc-detail-icon { align-items: center; background: var(--sc-secondary); border-radius: .6rem; color: var(--sc-primary); display: flex; flex: 0 0 auto; height: 2.1rem; justify-content: center; width: 2.1rem; }
        .sc-detail-title { color: var(--sc-fg); font-size: .9rem; font-weight: 800; margin-top: .55rem; }
        .sc-detail-copy { color: var(--sc-muted); font-size: .7rem; line-height: 1.5; margin-top: .25rem; }
        .sc-queue { border-left: 1px solid var(--sc-border); display: grid; gap: .45rem; padding-left: 1.25rem; }
        .sc-queue-item { align-items: center; color: var(--sc-muted); display: flex; font-size: .7rem; gap: .55rem; }
        .sc-queue-item svg { color: var(--sc-primary); flex: 0 0 auto; }
        .sc-detail-actions { align-items: center; border-top: 1px solid var(--sc-border); display: flex; flex-wrap: wrap; gap: .6rem; grid-column: 1 / -1; padding-top: 1rem; }
        .sc-primary-button { background: var(--sc-primary) !important; border-color: var(--sc-primary) !important; color: var(--sc-primary-foreground) !important; }
        .sc-secondary-button { background: var(--sc-secondary) !important; border-color: var(--sc-secondary) !important; color: var(--sc-secondary-foreground) !important; }
        .sc-admin-wrap > button { color: var(--sc-fg); }
        .sc-badge { background: var(--sc-secondary); border-color: transparent; color: var(--sc-secondary-foreground); font-size: .6rem; }
        .sc-action-message { align-items: center; background: var(--sc-secondary); border: 1px solid rgba(142, 18, 63, .18); border-radius: .65rem; color: var(--sc-secondary-foreground); display: flex; font-size: .7rem; font-weight: 700; gap: .45rem; margin-top: .75rem; padding: .7rem .8rem; }
        .sc-footer { align-items: center; color: var(--sc-muted); display: flex; font-family: "Geist Mono", ui-monospace, monospace; font-size: .58rem; justify-content: space-between; letter-spacing: .06em; margin-top: 2.25rem; text-transform: uppercase; }
        .sc-footer strong { align-items: center; color: var(--sc-primary); display: inline-flex; gap: .3rem; font-weight: 700; }

        @media (max-width: 720px) {
          .sc-frame { width: min(100% - 1.25rem, 40rem); }
          .sc-status { display: none; }
          .sc-hero { margin-top: 3.5rem; }
          .sc-hero-row { align-items: start; flex-direction: column; gap: 1rem; }
          .sc-hero-copy { max-width: 30rem; }
          .sc-domain-strip { grid-template-columns: 1fr; gap: .5rem; }
          .sc-domain, .sc-domain:first-child, .sc-domain:last-child { border-radius: .65rem; }
          .sc-workspace-tabs { grid-template-columns: 1fr; }
          .sc-workspace-tab { min-height: 5.5rem; }
          .sc-detail-card { grid-template-columns: 1fr; }
          .sc-queue { border-left: 0; border-top: 1px solid hsl(var(--border)); padding-left: 0; padding-top: 1rem; }
          .sc-detail-actions { grid-column: auto; }
          .sc-footer { align-items: start; flex-direction: column; gap: .45rem; }
        }
      `}</style>

      <div className="sc-frame">
        <header className="sc-header">
          <div className="sc-brand">
            <span aria-hidden="true" className="sc-brand-mark">AZ</span>
            <div>
              <div className="sc-brand-name">AdventureZone</div>
              <span className="sc-brand-subtitle">Command Terminal</span>
            </div>
          </div>
          <div className="sc-header-actions">
            <span className="sc-status"><span aria-hidden="true" className="sc-status-dot" />System ready</span>
            <div className="sc-admin-wrap">
              <Button aria-expanded={adminOpen} aria-label="Open administrator access" className="sc-admin-button" onClick={() => setAdminOpen((open) => !open)} size="icon" title="Administrator access" variant="outline">
                <Shield aria-hidden="true" size={16} strokeWidth={1.8} />
              </Button>
              {adminOpen ? (
                <div className="sc-admin-popover" role="status">
                  <strong>Administrator access</strong>
                  <p>Secure maintenance tools are available from the command terminal.</p>
                  <Button className="sc-dismiss-button px-0" onClick={() => setAdminOpen(false)} size="sm" variant="link">Dismiss</Button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <section aria-labelledby="stacked-title" className="sc-hero">
          <div className="sc-hero-kicker">Choose your workspace</div>
          <div className="sc-hero-row">
            <h1 className="sc-title" id="stacked-title">AdventureZone <em>Command Terminal</em></h1>
            <p className="sc-hero-copy">Bookings, contacts, routes, and calls all in one place. Select a role to continue into the right workspace.</p>
          </div>
          <div className="sc-domain-strip" aria-label="Command surface areas">
            <div className="sc-domain"><span className="sc-domain-index">01</span><span className="sc-domain-label">Bookings</span><span className="sc-domain-detail">Keep event details moving.</span></div>
            <div className="sc-domain"><span className="sc-domain-index">02</span><span className="sc-domain-label">Contacts</span><span className="sc-domain-detail">Make every handoff clear.</span></div>
            <div className="sc-domain"><span className="sc-domain-index">03</span><span className="sc-domain-label">Routes & calls</span><span className="sc-domain-detail">Stay ready for the next stop.</span></div>
          </div>
        </section>

        <section aria-labelledby="workspace-title" className="sc-workspace-section">
          <div className="sc-section-heading">
            <div>
              <div className="sc-eyebrow">Access points</div>
              <h2 className="sc-section-title" id="workspace-title">Enter your workspace</h2>
            </div>
            <span aria-label="Two workspaces available" className="sc-count">02 available</span>
          </div>

          <div className="sc-workspace-tabs" role="tablist" aria-label="Workspace selection">
            {workspaces.map(({ id, label, detail, count, icon: Icon }) => {
              const active = selectedWorkspace === id;
              return (
                <Button
                  aria-selected={active}
                  className={cn("sc-workspace-tab", active && "sc-workspace-tab-active")}
                  data-active={active}
                  key={id}
                  onClick={() => chooseWorkspace(id)}
                  role="tab"
                  variant="outline"
                >
                  <span className="sc-tab-icon"><Icon aria-hidden="true" size={18} strokeWidth={1.8} /></span>
                  <span className="sc-tab-copy"><span className="sc-tab-label">{label}</span><span className="sc-tab-detail">{detail}</span></span>
                  <span className="sc-tab-count">{count}</span>
                </Button>
              );
            })}
          </div>

          <Card className="sc-detail-card">
            <div className="sc-detail-intro">
              <span className="sc-detail-icon"><ActiveIcon aria-hidden="true" size={17} strokeWidth={1.8} /></span>
              <div>
                <Badge className="sc-badge" variant="secondary">{activeWorkspace.shortLabel} workspace selected</Badge>
                <h3 className="sc-detail-title">{activeWorkspace.label}</h3>
                <p className="sc-detail-copy">Your next useful actions are grouped here so the day can move forward without extra searching.</p>
              </div>
            </div>
            <div className="sc-queue" aria-label={`${activeWorkspace.label} ready items`}>
              {activeWorkspace.queue.map((item) => <div className="sc-queue-item" key={item}><Check aria-hidden="true" size={13} strokeWidth={2.3} />{item}</div>)}
            </div>
            <div className="sc-detail-actions">
              <Button className="sc-primary-button" onClick={() => setActionMessage(`Opening ${activeWorkspace.label}.`)} type="button">
                Continue to {activeWorkspace.shortLabel}
                <ArrowRight aria-hidden="true" size={15} />
              </Button>
              <Button className="sc-secondary-button" onClick={() => setActionMessage("Workspace brief is ready to review.")} type="button" variant="secondary">
                <Sparkles aria-hidden="true" size={15} />
                View workspace brief
              </Button>
            </div>
          </Card>
          {actionMessage ? <div className="sc-action-message" role="status"><Sparkles aria-hidden="true" size={14} />{actionMessage}</div> : null}
        </section>

        <footer className="sc-footer">
          <span>AdventureZone · Operational workspace</span>
          <strong><CircleHelp aria-hidden="true" size={12} /> Help is always nearby</strong>
        </footer>
      </div>
    </main>
  );
}