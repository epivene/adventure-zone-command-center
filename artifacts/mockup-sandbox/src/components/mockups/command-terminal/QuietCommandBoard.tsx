import { useState, type CSSProperties } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  MapPinned,
  Menu,
  Shield,
  Sparkles,
  UsersRound,
  X,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type WorkspaceId = "office" | "manager";

type QueueItem = {
  id: string;
  label: string;
  detail: string;
  icon: typeof CalendarDays;
  tone: "raspberry" | "terracotta" | "teal";
};

const workspaces: Array<{
  id: WorkspaceId;
  label: string;
  shortLabel: string;
  eyebrow: string;
  detail: string;
  icon: typeof BriefcaseBusiness;
  count: string;
  meta: string;
}> = [
  {
    id: "office",
    label: "Office Coordinator",
    shortLabel: "Office",
    eyebrow: "Workspace 01",
    detail: "Bookings, contacts, routes, and calls",
    icon: BriefcaseBusiness,
    count: "08",
    meta: "8 items ready",
  },
  {
    id: "manager",
    label: "Leg Managers",
    shortLabel: "Field",
    eyebrow: "Workspace 02",
    detail: "Field-ready operations and trip planning",
    icon: MapPinned,
    count: "04",
    meta: "4 items ready",
  },
];

const officeQueue: QueueItem[] = [
  { id: "office-1", label: "Confirm Summit Week details", detail: "Pine Ridge Adventure · due today", icon: CalendarDays, tone: "raspberry" },
  { id: "office-2", label: "Call Maya Chen", detail: "Fall retreat proposal · 10:30 AM", icon: UsersRound, tone: "teal" },
  { id: "office-3", label: "Review two route changes", detail: "Operations inbox · 2 updates", icon: MapPinned, tone: "terracotta" },
];

const managerQueue: QueueItem[] = [
  { id: "manager-1", label: "Check in for Summit Week", detail: "Estes Park · starts in 42 min", icon: MapPinned, tone: "raspberry" },
  { id: "manager-2", label: "Review crew assignments", detail: "4 people · ready to confirm", icon: UsersRound, tone: "teal" },
  { id: "manager-3", label: "Capture event notes", detail: "Wrap-up from yesterday", icon: CalendarDays, tone: "terracotta" },
];

const quietTheme = {
  "--background": "192 42% 10%",
  "--foreground": "48 27% 93%",
  "--card": "192 35% 14%",
  "--card-foreground": "48 27% 93%",
  "--popover": "191 33% 17%",
  "--popover-foreground": "48 27% 93%",
  "--primary": "339 82% 68%",
  "--primary-foreground": "192 42% 10%",
  "--secondary": "338 41% 24%",
  "--secondary-foreground": "345 100% 91%",
  "--muted": "190 24% 18%",
  "--muted-foreground": "184 16% 68%",
  "--accent": "27 64% 66%",
  "--accent-foreground": "192 42% 10%",
  "--destructive": "4 58% 66%",
  "--destructive-foreground": "192 42% 10%",
  "--border": "190 24% 25%",
  "--input": "190 24% 31%",
  "--ring": "339 82% 68%",
  "--sidebar": "193 45% 8%",
  "--sidebar-foreground": "48 27% 93%",
  "--sidebar-border": "190 30% 20%",
  "--sidebar-accent": "338 41% 18%",
  "--font-sans": "DM Sans, sans-serif",
  "--font-serif": "Georgia, serif",
  "--font-mono": "Geist Mono, monospace",
} as CSSProperties;

export function QuietCommandBoard() {
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceId>("office");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [completedItems, setCompletedItems] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState("");

  const activeWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspace) ?? workspaces[0];
  const activeQueue = selectedWorkspace === "office" ? officeQueue : managerQueue;
  const pendingCount = activeQueue.filter((item) => !completedItems.includes(item.id)).length;

  const chooseWorkspace = (id: WorkspaceId) => {
    setSelectedWorkspace(id);
    setMobileNavOpen(false);
    setActionMessage("");
  };

  const toggleCompleted = (item: QueueItem) => {
    const isComplete = completedItems.includes(item.id);
    setCompletedItems((current) => isComplete ? current.filter((id) => id !== item.id) : [...current, item.id]);
    setActionMessage(isComplete ? `${item.label} returned to the queue.` : `${item.label} marked complete.`);
  };

  return (
    <main className="quiet-board" style={quietTheme}>
      <style>{`
        .quiet-board {
          min-height: 100dvh;
          background:
            radial-gradient(circle at 78% 8%, hsl(var(--accent) / .08), transparent 27rem),
            linear-gradient(180deg, hsl(var(--background)), hsl(192 43% 8%));
          color: hsl(var(--foreground));
          font-family: var(--font-sans);
          overflow: hidden;
        }
        .quiet-board *, .quiet-board *::before, .quiet-board *::after { box-sizing: border-box; }
        .quiet-board button { font-family: inherit; }
        .qc-shell { display: grid; grid-template-columns: 18rem minmax(0, 1fr); min-height: 100dvh; }
        .qc-rail {
          background: hsl(var(--sidebar));
          border-right: 1px solid hsl(var(--sidebar-border));
          color: hsl(var(--sidebar-foreground));
          display: flex;
          flex-direction: column;
          padding: 1.25rem;
          position: relative;
        }
        .qc-rail::after {
          background: linear-gradient(180deg, hsl(var(--primary) / .08), transparent 38%, hsl(var(--accent) / .06));
          content: "";
          inset: 0;
          pointer-events: none;
          position: absolute;
        }
        .qc-rail > * { position: relative; z-index: 1; }
        .qc-brand { align-items: center; display: flex; gap: .7rem; }
        .qc-mark {
          align-items: center;
          background: hsl(var(--primary));
          border-radius: .625rem;
          color: hsl(var(--primary-foreground));
          display: flex;
          font-size: .75rem;
          font-weight: 800;
          height: 2.25rem;
          justify-content: center;
          letter-spacing: -.05em;
          width: 2.25rem;
        }
        .qc-brand-name { font-size: .9rem; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; }
        .qc-brand-subtitle, .qc-label, .qc-eyebrow, .qc-footer {
          font-family: var(--font-mono);
          letter-spacing: .1em;
          text-transform: uppercase;
        }
        .qc-brand-subtitle { color: hsl(var(--sidebar-foreground) / .5); display: block; font-size: .57rem; margin-top: .28rem; }
        .qc-rule { border-top: 1px solid hsl(var(--sidebar-foreground) / .12); margin: 2rem 0 1.1rem; }
        .qc-label { color: hsl(var(--sidebar-foreground) / .45); font-size: .58rem; }
        .qc-workspace-list { display: grid; gap: .55rem; margin-top: .8rem; }
        .qc-workspace-button {
          align-items: center;
          background: transparent !important;
          border: 1px solid hsl(var(--sidebar-foreground) / .12) !important;
          border-radius: .625rem !important;
          color: hsl(var(--sidebar-foreground)) !important;
          display: grid !important;
          gap: .7rem;
          grid-template-columns: 2rem minmax(0, 1fr) auto;
          min-height: 0 !important;
          padding: .7rem !important;
          text-align: left;
          transition: background-color 150ms, border-color 150ms, transform 150ms;
          width: 100%;
        }
        .qc-workspace-button:hover { background: hsl(var(--sidebar-foreground) / .06) !important; border-color: hsl(var(--sidebar-foreground) / .27) !important; transform: translateX(.1rem); }
        .qc-workspace-button[data-active="true"] { background: hsl(var(--card)) !important; border-color: hsl(var(--card)) !important; color: hsl(var(--card-foreground)) !important; }
        .qc-workspace-icon { align-items: center; background: hsl(var(--sidebar-foreground) / .08); border-radius: .5rem; color: hsl(var(--accent)); display: flex; height: 2rem; justify-content: center; width: 2rem; }
        .qc-workspace-button[data-active="true"] .qc-workspace-icon { background: hsl(var(--secondary)); color: hsl(var(--primary)); }
        .qc-workspace-copy { min-width: 0; }
        .qc-workspace-eyebrow { color: hsl(var(--sidebar-foreground) / .45); display: block; font-family: var(--font-mono); font-size: .52rem; letter-spacing: .08em; text-transform: uppercase; }
        .qc-workspace-button[data-active="true"] .qc-workspace-eyebrow { color: hsl(var(--primary)); }
        .qc-workspace-label { display: block; font-size: .78rem; font-weight: 800; margin-top: .22rem; }
        .qc-workspace-detail { color: hsl(var(--sidebar-foreground) / .5); display: block; font-size: .63rem; line-height: 1.35; margin-top: .22rem; }
        .qc-workspace-button[data-active="true"] .qc-workspace-detail { color: hsl(var(--muted-foreground)); }
        .qc-workspace-count { align-self: start; color: hsl(var(--sidebar-foreground) / .44); font-family: var(--font-mono); font-size: .6rem; }
        .qc-workspace-button[data-active="true"] .qc-workspace-count { color: hsl(var(--primary)); }
        .qc-status { border-top: 1px solid hsl(var(--sidebar-foreground) / .12); display: flex; gap: .6rem; margin-top: auto; padding-top: 1.1rem; }
        .qc-status-dot { background: hsl(var(--accent)); border-radius: 999px; box-shadow: 0 0 0 .24rem hsl(var(--accent) / .12); flex: 0 0 auto; height: .42rem; margin-top: .3rem; width: .42rem; }
        .qc-status strong { display: block; font-size: .72rem; }
        .qc-status span { color: hsl(var(--sidebar-foreground) / .52); display: block; font-size: .64rem; line-height: 1.45; margin-top: .18rem; }
        .qc-main { min-width: 0; padding: 1.25rem clamp(1rem, 4vw, 4rem) 1.6rem; }
        .qc-topbar { align-items: center; display: flex; justify-content: space-between; min-height: 2.4rem; }
        .qc-breadcrumb { align-items: center; color: hsl(var(--muted-foreground)); display: flex; font-size: .68rem; gap: .42rem; }
        .qc-breadcrumb strong { color: hsl(var(--foreground)); font-weight: 800; }
        .qc-top-actions { align-items: center; display: flex; gap: .55rem; }
        .qc-icon-button { background: hsl(var(--card)) !important; border-color: hsl(var(--border)) !important; color: hsl(var(--muted-foreground)) !important; }
        .qc-icon-button:hover { color: hsl(var(--foreground)) !important; }
        .qc-admin-wrap { position: relative; }
        .qc-admin-popover { background: hsl(var(--popover)); border: 1px solid hsl(var(--border)); border-radius: .625rem; box-shadow: 0 1.25rem 3rem hsl(192 46% 4% / .42); padding: .9rem; position: absolute; right: 0; top: 2.65rem; width: min(17rem, calc(100vw - 2rem)); z-index: 4; }
        .qc-admin-popover strong { display: block; font-size: .76rem; }
        .qc-admin-popover p { color: hsl(var(--muted-foreground)); font-size: .68rem; line-height: 1.45; margin: .35rem 0 .75rem; }
        .qc-admin-popover button { color: hsl(var(--primary)); font-size: .68rem; font-weight: 800; padding: 0; }
        .qc-intro { align-items: end; display: flex; justify-content: space-between; gap: 2rem; margin: clamp(3rem, 8vh, 5.8rem) auto 2rem; max-width: 70rem; }
        .qc-kicker { align-items: center; color: hsl(var(--primary)); display: flex; font-family: var(--font-mono); font-size: .6rem; font-weight: 700; gap: .55rem; letter-spacing: .11em; text-transform: uppercase; }
        .qc-kicker-line { background: hsl(var(--primary)); height: 1px; width: 1.8rem; }
        .qc-title { font-family: var(--font-serif); font-size: clamp(2.25rem, 5vw, 4.1rem); font-weight: 700; letter-spacing: -.055em; line-height: .98; margin: .75rem 0 0; max-width: 13ch; }
        .qc-title em { color: hsl(var(--accent)); font-style: italic; }
        .qc-intro-copy { color: hsl(var(--muted-foreground)); font-size: .8rem; line-height: 1.6; margin: .9rem 0 0; max-width: 27rem; }
        .qc-continue { background: hsl(var(--primary)) !important; border-color: hsl(var(--primary)) !important; border-radius: .625rem !important; box-shadow: 0 .7rem 1.6rem hsl(var(--primary) / .16); color: hsl(var(--primary-foreground)) !important; font-weight: 800 !important; }
        .qc-continue svg { transition: transform 150ms; }
        .qc-continue:hover svg { transform: translateX(.15rem); }
        .qc-grid { display: grid; gap: .9rem; grid-template-columns: minmax(0, 1.55fr) minmax(15rem, .85fr); margin: 0 auto; max-width: 70rem; }
        .qc-card { background: hsl(var(--card)) !important; border-color: hsl(var(--border)) !important; border-radius: .625rem !important; box-shadow: 0 .8rem 2rem hsl(192 46% 4% / .12) !important; }
        .qc-card-header { border-bottom: 1px solid hsl(var(--border)); flex-direction: row !important; justify-content: space-between; padding: 1rem 1.1rem !important; }
        .qc-eyebrow { color: hsl(var(--muted-foreground)); font-size: .56rem; }
        .qc-card-title { color: hsl(var(--card-foreground)); font-size: .98rem !important; margin-top: .25rem; }
        .qc-card-count { color: hsl(var(--primary)); font-family: var(--font-mono); font-size: .66rem; font-weight: 800; }
        .qc-queue { padding: .25rem .65rem .55rem; }
        .qc-queue-item { align-items: center; border-bottom: 1px solid hsl(var(--border) / .62); display: grid; gap: .7rem; grid-template-columns: 1.9rem minmax(0, 1fr) auto; padding: .78rem .45rem; }
        .qc-queue-item:last-child { border-bottom: 0; }
        .qc-queue-icon { align-items: center; border-radius: .5rem; display: flex; height: 1.9rem; justify-content: center; width: 1.9rem; }
        .qc-queue-icon[data-tone="raspberry"] { background: hsl(var(--secondary)); color: hsl(var(--primary)); }
        .qc-queue-icon[data-tone="terracotta"] { background: hsl(var(--accent) / .16); color: hsl(var(--accent)); }
        .qc-queue-icon[data-tone="teal"] { background: hsl(var(--chart-3) / .18); color: hsl(var(--chart-3)); }
        .qc-queue-label { color: hsl(var(--card-foreground)); display: block; font-size: .74rem; font-weight: 800; }
        .qc-queue-detail { color: hsl(var(--muted-foreground)); display: block; font-size: .62rem; margin-top: .2rem; }
        .qc-done { border-color: hsl(var(--border)) !important; color: hsl(var(--muted-foreground)) !important; font-size: .62rem !important; min-height: 2rem !important; padding: .35rem .5rem !important; }
        .qc-done[data-complete="true"] { background: hsl(var(--secondary)) !important; border-color: hsl(var(--secondary)) !important; color: hsl(var(--primary)) !important; }
        .qc-queue-item[data-complete="true"] .qc-queue-label { color: hsl(var(--muted-foreground)); text-decoration: line-through; }
        .qc-queue-item[data-complete="true"] .qc-queue-detail { opacity: .65; }
        .qc-side { display: grid; gap: .9rem; }
        .qc-next-card { background: linear-gradient(145deg, hsl(var(--card)), hsl(192 35% 16%)) !important; }
        .qc-next-copy { padding: 1rem 1.1rem 1.15rem; }
        .qc-next-name { font-family: var(--font-serif); font-size: 1.18rem; font-weight: 700; letter-spacing: -.03em; }
        .qc-next-meta { color: hsl(var(--muted-foreground)); font-size: .68rem; line-height: 1.5; margin-top: .35rem; }
        .qc-next-meta strong { color: hsl(var(--foreground)); }
        .qc-next-link { margin-top: .9rem; }
        .qc-next-link:hover svg { transform: translateX(.15rem); }
        .qc-next-link svg { transition: transform 150ms; }
        .qc-signal { padding: 1rem 1.1rem !important; }
        .qc-signal-row { align-items: center; display: flex; gap: .65rem; }
        .qc-signal-icon { align-items: center; background: hsl(var(--accent) / .16); border-radius: .5rem; color: hsl(var(--accent)); display: flex; height: 1.9rem; justify-content: center; width: 1.9rem; }
        .qc-signal-title { color: hsl(var(--card-foreground)); font-size: .72rem; font-weight: 800; margin-top: .18rem; }
        .qc-signal-copy { color: hsl(var(--muted-foreground)); font-size: .65rem; line-height: 1.45; margin: .55rem 0 0 2.55rem; }
        .qc-action-message { align-items: center; background: hsl(var(--secondary)); border: 1px solid hsl(var(--primary) / .24); border-radius: .625rem; color: hsl(var(--secondary-foreground)); display: flex; font-size: .68rem; font-weight: 800; gap: .45rem; margin: .9rem auto 0; max-width: 70rem; padding: .65rem .8rem; }
        .qc-footer { align-items: center; color: hsl(var(--muted-foreground)); display: flex; font-size: .52rem; justify-content: space-between; margin: 1.7rem auto 0; max-width: 70rem; }
        .qc-footer strong { align-items: center; color: hsl(var(--accent)); display: inline-flex; gap: .35rem; font-weight: 700; }
        .qc-mobile-menu { display: none; }
        @media (max-width: 860px) {
          .qc-shell { grid-template-columns: 15.5rem minmax(0, 1fr); }
          .qc-rail { padding: 1rem; }
          .qc-workspace-detail { display: none; }
          .qc-intro { align-items: start; flex-direction: column; margin-top: 3.2rem; }
          .qc-grid { grid-template-columns: 1fr; }
          .qc-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 620px) {
          .qc-shell { display: block; }
          .qc-rail { min-height: auto; padding: .75rem 1rem; }
          .qc-rule, .qc-status, .qc-label, .qc-workspace-list { display: none; }
          .qc-rail[data-mobile-open="true"] { padding-bottom: 1rem; }
          .qc-rail[data-mobile-open="true"] .qc-label, .qc-rail[data-mobile-open="true"] .qc-workspace-list { display: block; }
          .qc-rail[data-mobile-open="true"] .qc-workspace-list { margin-top: .7rem; }
          .qc-mobile-menu { display: inline-flex !important; margin-left: auto; }
          .qc-main { padding: 1rem; }
          .qc-top-actions { gap: .35rem; }
          .qc-intro { gap: 1.1rem; margin: 2.4rem 0 1.6rem; }
          .qc-title { font-size: clamp(2.15rem, 12vw, 3.15rem); }
          .qc-continue { width: 100%; }
          .qc-side { grid-template-columns: 1fr; }
          .qc-queue-item { grid-template-columns: 1.9rem minmax(0, 1fr); }
          .qc-done { grid-column: 2; justify-self: start; }
          .qc-footer { align-items: flex-start; flex-direction: column; gap: .45rem; margin-top: 1.4rem; }
        }
      `}</style>

      <div className="qc-shell">
        <aside className="qc-rail" data-mobile-open={mobileNavOpen}>
          <div className="qc-brand">
            <span aria-hidden="true" className="qc-mark">AZ</span>
            <div>
              <div className="qc-brand-name">AdventureZone</div>
              <span className="qc-brand-subtitle">Field log / quiet mode</span>
            </div>
            <Button
              aria-expanded={mobileNavOpen}
              aria-label="Toggle workspace navigation"
              className="qc-icon-button qc-mobile-menu"
              onClick={() => setMobileNavOpen((open) => !open)}
              size="icon"
              variant="outline"
            >
              {mobileNavOpen ? <X aria-hidden="true" size={16} /> : <Menu aria-hidden="true" size={16} />}
            </Button>
          </div>

          <div className="qc-rule" />
          <div className="qc-label">Choose a workspace</div>
          <nav aria-label="Workspace selection" className="qc-workspace-list">
            {workspaces.map(({ id, label, detail, eyebrow, icon: Icon, count }) => {
              const active = selectedWorkspace === id;
              return (
                <Button
                  aria-current={active ? "page" : undefined}
                  aria-label={`${label}, ${count} items ready`}
                  className="qc-workspace-button"
                  data-active={active}
                  key={id}
                  onClick={() => chooseWorkspace(id)}
                  variant="ghost"
                >
                  <span className="qc-workspace-icon"><Icon aria-hidden="true" size={16} strokeWidth={1.8} /></span>
                  <span className="qc-workspace-copy">
                    <span className="qc-workspace-eyebrow">{eyebrow}</span>
                    <span className="qc-workspace-label">{label}</span>
                    <span className="qc-workspace-detail">{detail}</span>
                  </span>
                  <span className="qc-workspace-count">{count}</span>
                </Button>
              );
            })}
          </nav>

          <div className="qc-status">
            <span aria-hidden="true" className="qc-status-dot" />
            <div><strong>System ready</strong><span>All operational surfaces are synced.</span></div>
          </div>
        </aside>

        <section className="qc-main">
          <header className="qc-topbar">
            <div className="qc-breadcrumb"><span>Command Terminal</span><ChevronRight aria-hidden="true" size={12} /><strong>{activeWorkspace.shortLabel}</strong></div>
            <div className="qc-top-actions">
              <span aria-label="System ready" className="qc-status-dot" title="System ready" />
              <div className="qc-admin-wrap">
                <Button
                  aria-expanded={adminOpen}
                  aria-label="Open administrator access"
                  className="qc-icon-button"
                  onClick={() => setAdminOpen((open) => !open)}
                  size="icon"
                  variant="outline"
                >
                  <Shield aria-hidden="true" size={16} strokeWidth={1.8} />
                </Button>
                {adminOpen ? (
                  <div className="qc-admin-popover" role="status">
                    <strong>Administrator access</strong>
                    <p>Maintenance tools are available from the command terminal.</p>
                    <Button className="h-auto min-h-0 p-0" onClick={() => setAdminOpen(false)} size="sm" variant="link">Dismiss</Button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div className="qc-intro">
            <div>
              <div className="qc-kicker"><span aria-hidden="true" className="qc-kicker-line" />Evening operations log</div>
              <h1 className="qc-title">Begin with what needs <em>care.</em></h1>
              <p className="qc-intro-copy">A quieter command surface for {activeWorkspace.label.toLowerCase()}. Pick up the next useful action without losing the thread.</p>
            </div>
            <Button className="qc-continue" onClick={() => setActionMessage(`Opening ${activeWorkspace.label}.`)} size="default">
              Continue to {activeWorkspace.shortLabel}
              <ArrowRight aria-hidden="true" size={15} />
            </Button>
          </div>

          <div className="qc-grid">
            <Card className="qc-card" aria-labelledby="quiet-queue-title">
              <CardHeader className="qc-card-header">
                <div><div className="qc-eyebrow">Action queue</div><CardTitle className="qc-card-title" id="quiet-queue-title">Your next moves</CardTitle></div>
                <span className="qc-card-count">{String(pendingCount).padStart(2, "0")} open</span>
              </CardHeader>
              <CardContent className="qc-queue">
                {activeQueue.map((item) => {
                  const complete = completedItems.includes(item.id);
                  const Icon = item.icon;
                  return (
                    <div className="qc-queue-item" data-complete={complete} key={item.id}>
                      <span className="qc-queue-icon" data-tone={item.tone}><Icon aria-hidden="true" size={15} strokeWidth={1.8} /></span>
                      <span><span className="qc-queue-label">{item.label}</span><span className="qc-queue-detail">{item.detail}</span></span>
                      <Button
                        aria-label={complete ? `${item.label} complete` : `Mark ${item.label} complete`}
                        className="qc-done"
                        data-complete={complete}
                        onClick={() => toggleCompleted(item)}
                        size="sm"
                        variant="outline"
                      >
                        <Check aria-hidden="true" size={13} />{complete ? "Done" : "Complete"}
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="qc-side">
              <Card className="qc-card qc-next-card" aria-labelledby="quiet-next-title">
                <CardHeader className="qc-card-header">
                  <div><div className="qc-eyebrow">Coming up</div><CardTitle className="qc-card-title" id="quiet-next-title">Next event</CardTitle></div>
                  <span className="qc-card-count">01</span>
                </CardHeader>
                <CardContent className="qc-next-copy">
                  <div className="qc-next-name">{selectedWorkspace === "office" ? "Summit Week 2025" : "Summit Week check-in"}</div>
                  <div className="qc-next-meta"><strong>{selectedWorkspace === "office" ? "Jul 18 · Estes Park, CO" : "Today · Estes Park, CO"}</strong><br />Keep the handoff clear before the next stop.</div>
                  <Button className="qc-next-link" onClick={() => setActionMessage("Event brief opened.")} size="sm" variant="secondary">Open event brief <ArrowRight aria-hidden="true" size={13} /></Button>
                </CardContent>
              </Card>

              <Card className="qc-card qc-signal" aria-labelledby="quiet-signal-title">
                <div className="qc-signal-row">
                  <span className="qc-signal-icon"><Clock3 aria-hidden="true" size={15} /></span>
                  <div><div className="qc-eyebrow">Stay oriented</div><h2 className="qc-signal-title" id="quiet-signal-title">One clear starting point</h2></div>
                </div>
                <p className="qc-signal-copy">Your {activeWorkspace.meta.toLowerCase()} are grouped here so the day can move forward without extra searching.</p>
              </Card>
            </div>
          </div>

          {actionMessage ? <div className="qc-action-message" role="status"><Sparkles aria-hidden="true" size={14} />{actionMessage}</div> : null}

          <footer className="qc-footer"><span>AdventureZone · Field log / quiet mode</span><strong><Zap aria-hidden="true" size={11} /> <span>Secure access</span><CircleHelp aria-hidden="true" size={11} /></strong></footer>
        </section>
      </div>
    </main>
  );
}