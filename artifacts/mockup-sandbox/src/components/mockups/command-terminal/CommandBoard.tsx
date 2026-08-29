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
} from "lucide-react";

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

export function CommandBoard() {
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceId>("office");
  const [adminOpen, setAdminOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [completedItems, setCompletedItems] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState("");

  const activeWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspace)!;
  const activeQueue = selectedWorkspace === "office" ? officeQueue : managerQueue;
  const pendingCount = activeQueue.filter((item) => !completedItems.includes(item.id)).length;

  const chooseWorkspace = (id: WorkspaceId) => {
    setSelectedWorkspace(id);
    setMobileNavOpen(false);
    setActionMessage("");
  };

  const completeItem = (item: QueueItem) => {
    setCompletedItems((current) => (current.includes(item.id) ? current : [...current, item.id]));
    setActionMessage(`${item.label} marked complete.`);
  };

  return (
    <main
      className="command-board"
      style={
        {
          "--cb-bg": "#f3f5f0",
          "--cb-fg": "#173b48",
          "--cb-card": "#fbfcf8",
          "--cb-border": "#d8e2dd",
          "--cb-muted": "#71848a",
          "--cb-primary": "#d51352",
          "--cb-primary-foreground": "#fff7fa",
          "--cb-secondary": "#fde7ef",
          "--cb-secondary-foreground": "#8e123f",
          "--cb-accent": "#d4874f",
          "--cb-sidebar": "#173b48",
          "--cb-sidebar-foreground": "#f8f5ee",
        } as CSSProperties
      }
    >
      <style>{`
        .command-board {
          min-height: 100dvh;
          background: var(--cb-bg);
          color: var(--cb-fg);
          font-family: "DM Sans", ui-sans-serif, system-ui, sans-serif;
          overflow: hidden;
        }
        .command-board *, .command-board *::before, .command-board *::after { box-sizing: border-box; }
        .command-board button { font: inherit; }
        .cb-shell { display: grid; grid-template-columns: 19rem minmax(0, 1fr); min-height: 100dvh; }
        .cb-rail { background: var(--cb-sidebar); color: var(--cb-sidebar-foreground); display: flex; flex-direction: column; padding: 1.5rem; position: relative; }
        .cb-rail::after { background: linear-gradient(160deg, rgba(213,19,82,.24), transparent 42%, rgba(212,135,79,.16)); content: ""; inset: 0; pointer-events: none; position: absolute; }
        .cb-rail > * { position: relative; z-index: 1; }
        .cb-brand { align-items: center; display: flex; gap: .75rem; }
        .cb-brand-mark { align-items: center; background: var(--cb-primary); border-radius: .75rem; color: var(--cb-primary-foreground); display: flex; font-size: .8rem; font-weight: 800; height: 2.5rem; justify-content: center; letter-spacing: -.04em; width: 2.5rem; }
        .cb-brand-name { font-size: .95rem; font-weight: 800; letter-spacing: -.025em; line-height: 1.1; }
        .cb-brand-subtitle { color: rgba(248,245,238,.55); display: block; font-family: "Geist Mono", ui-monospace, monospace; font-size: .58rem; letter-spacing: .1em; margin-top: .3rem; text-transform: uppercase; }
        .cb-rail-rule { border-top: 1px solid rgba(248,245,238,.14); margin: 2rem 0 1.35rem; }
        .cb-rail-label { color: rgba(248,245,238,.48); font-family: "Geist Mono", ui-monospace, monospace; font-size: .62rem; letter-spacing: .11em; text-transform: uppercase; }
        .cb-workspace-list { display: grid; gap: .6rem; margin-top: .8rem; }
        .cb-workspace-button { align-items: center; background: transparent; border: 1px solid rgba(248,245,238,.12); border-radius: .75rem; color: var(--cb-sidebar-foreground); cursor: pointer; display: grid; gap: .75rem; grid-template-columns: 2.15rem minmax(0,1fr) auto; padding: .75rem; text-align: left; transition: background 150ms, border-color 150ms, transform 150ms; width: 100%; }
        .cb-workspace-button:hover { background: rgba(248,245,238,.08); border-color: rgba(248,245,238,.28); transform: translateX(.15rem); }
        .cb-workspace-button[data-active="true"] { background: var(--cb-card); border-color: var(--cb-card); color: var(--cb-fg); box-shadow: 0 .75rem 1.5rem rgba(8,27,35,.2); }
        .cb-workspace-icon { align-items: center; background: rgba(248,245,238,.1); border-radius: .6rem; color: var(--cb-accent); display: flex; height: 2.15rem; justify-content: center; width: 2.15rem; }
        .cb-workspace-button[data-active="true"] .cb-workspace-icon { background: var(--cb-secondary); color: var(--cb-primary); }
        .cb-workspace-copy { min-width: 0; }
        .cb-workspace-eyebrow { color: rgba(248,245,238,.52); display: block; font-family: "Geist Mono", ui-monospace, monospace; font-size: .57rem; letter-spacing: .08em; text-transform: uppercase; }
        .cb-workspace-button[data-active="true"] .cb-workspace-eyebrow { color: var(--cb-primary); }
        .cb-workspace-label { display: block; font-size: .85rem; font-weight: 800; margin-top: .25rem; }
        .cb-workspace-detail { color: rgba(248,245,238,.58); display: block; font-size: .68rem; line-height: 1.35; margin-top: .25rem; }
        .cb-workspace-button[data-active="true"] .cb-workspace-detail { color: var(--cb-muted); }
        .cb-workspace-count { align-self: start; color: rgba(248,245,238,.5); font-family: "Geist Mono", ui-monospace, monospace; font-size: .65rem; padding-top: .05rem; }
        .cb-workspace-button[data-active="true"] .cb-workspace-count { color: var(--cb-primary); }
        .cb-rail-bottom { border-top: 1px solid rgba(248,245,238,.14); margin-top: auto; padding-top: 1.25rem; }
        .cb-system-status { align-items: flex-start; display: flex; gap: .6rem; }
        .cb-status-dot { background: var(--cb-primary); border-radius: 999px; box-shadow: 0 0 0 .25rem rgba(213,19,82,.14); flex: 0 0 auto; height: .45rem; margin-top: .3rem; width: .45rem; }
        .cb-system-status strong { display: block; font-size: .76rem; }
        .cb-system-status span { color: rgba(248,245,238,.55); display: block; font-size: .68rem; line-height: 1.45; margin-top: .2rem; }
        .cb-main { min-width: 0; padding: 1.4rem clamp(1.1rem, 4vw, 4rem) 2rem; }
        .cb-topbar { align-items: center; display: flex; justify-content: space-between; min-height: 2.7rem; }
        .cb-breadcrumb { align-items: center; color: var(--cb-muted); display: flex; font-size: .72rem; gap: .45rem; }
        .cb-breadcrumb strong { color: var(--cb-fg); font-weight: 800; }
        .cb-top-actions { align-items: center; display: flex; gap: .65rem; }
        .cb-top-action { align-items: center; background: var(--cb-card); border: 1px solid var(--cb-border); border-radius: .6rem; color: var(--cb-muted); cursor: pointer; display: inline-flex; height: 2.25rem; justify-content: center; transition: background 150ms, border-color 150ms, color 150ms; width: 2.25rem; }
        .cb-top-action:hover, .cb-top-action[data-active="true"] { background: #edf4ef; border-color: #9ab6a9; color: var(--cb-fg); }
        .cb-admin-wrap { position: relative; }
        .cb-admin-popover { background: var(--cb-card); border: 1px solid var(--cb-border); border-radius: .75rem; box-shadow: 0 1.1rem 2.5rem rgba(23,59,72,.16); padding: 1rem; position: absolute; right: 0; top: 2.8rem; width: min(18rem, calc(100vw - 2rem)); z-index: 5; }
        .cb-admin-popover strong { display: block; font-size: .8rem; }
        .cb-admin-popover p { color: var(--cb-muted); font-size: .72rem; line-height: 1.45; margin: .35rem 0 .8rem; }
        .cb-dismiss { background: transparent; border: 0; color: var(--cb-primary); cursor: pointer; font-size: .72rem; font-weight: 800; padding: 0; }
        .cb-mobile-menu { display: none; }
        .cb-intro { align-items: end; display: flex; justify-content: space-between; gap: 2rem; margin: clamp(3rem, 9vh, 6.5rem) auto 2.25rem; max-width: 72rem; }
        .cb-kicker { align-items: center; color: var(--cb-primary); display: flex; font-family: "Geist Mono", ui-monospace, monospace; font-size: .63rem; font-weight: 700; gap: .55rem; letter-spacing: .1em; text-transform: uppercase; }
        .cb-kicker-line { background: var(--cb-primary); display: inline-block; height: 1px; width: 2rem; }
        .cb-title { font-size: clamp(2.2rem, 5vw, 4.3rem); font-weight: 800; letter-spacing: -.065em; line-height: .98; margin: .8rem 0 0; max-width: 12ch; }
        .cb-title em { color: var(--cb-primary); font-style: normal; }
        .cb-intro-copy { color: var(--cb-muted); font-size: .86rem; line-height: 1.55; margin: 1rem 0 0; max-width: 31rem; }
        .cb-continue { background: var(--cb-primary); border: 0; border-radius: .7rem; box-shadow: 0 .75rem 1.5rem rgba(213,19,82,.16); color: var(--cb-primary-foreground); cursor: pointer; display: inline-flex; flex: 0 0 auto; font-size: .78rem; font-weight: 800; gap: .6rem; padding: .8rem 1rem; transition: background 150ms, transform 150ms; }
        .cb-continue:hover { background: #b91146; transform: translateY(-.1rem); }
        .cb-continue svg { transition: transform 150ms; }
        .cb-continue:hover svg { transform: translateX(.15rem); }
        .cb-grid { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1.55fr) minmax(15rem, .85fr); margin: 0 auto; max-width: 72rem; }
        .cb-panel { background: var(--cb-card); border: 1px solid var(--cb-border); border-radius: 1rem; box-shadow: 0 .75rem 2rem rgba(32,71,77,.04); }
        .cb-panel-head { align-items: start; border-bottom: 1px solid #e5ebe5; display: flex; justify-content: space-between; gap: 1rem; padding: 1.15rem 1.25rem; }
        .cb-panel-eyebrow { color: #75908b; font-family: "Geist Mono", ui-monospace, monospace; font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; }
        .cb-panel-title { font-size: 1.05rem; font-weight: 800; letter-spacing: -.025em; margin: .3rem 0 0; }
        .cb-panel-count { color: var(--cb-primary); font-family: "Geist Mono", ui-monospace, monospace; font-size: .75rem; font-weight: 800; }
        .cb-queue { padding: .45rem .7rem .75rem; }
        .cb-queue-item { align-items: center; border-bottom: 1px solid #edf0eb; display: grid; gap: .75rem; grid-template-columns: 2rem minmax(0,1fr) auto; padding: .8rem .55rem; }
        .cb-queue-item:last-child { border-bottom: 0; }
        .cb-queue-icon { align-items: center; border-radius: .55rem; display: flex; height: 2rem; justify-content: center; width: 2rem; }
        .cb-queue-icon[data-tone="raspberry"] { background: var(--cb-secondary); color: var(--cb-primary); }
        .cb-queue-icon[data-tone="terracotta"] { background: #faecd9; color: #a66845; }
        .cb-queue-icon[data-tone="teal"] { background: #e3eee8; color: #397064; }
        .cb-queue-label { font-size: .79rem; font-weight: 800; }
        .cb-queue-detail { color: var(--cb-muted); display: block; font-size: .68rem; margin-top: .22rem; }
        .cb-done { align-items: center; background: transparent; border: 1px solid var(--cb-border); border-radius: .5rem; color: #71848a; cursor: pointer; display: inline-flex; font-size: .66rem; font-weight: 800; gap: .35rem; padding: .4rem .55rem; transition: background 150ms, border-color 150ms, color 150ms; }
        .cb-done:hover { background: #edf4ef; border-color: #9ab6a9; color: #315b66; }
        .cb-done[data-complete="true"] { background: #e2efe9; border-color: #b9d2c5; color: #397064; }
        .cb-queue-item[data-complete="true"] .cb-queue-label { color: #839596; text-decoration: line-through; }
        .cb-queue-item[data-complete="true"] .cb-queue-detail { color: #9ba8a6; }
        .cb-side { display: grid; gap: 1rem; }
        .cb-next-card { background: var(--cb-sidebar); border: 0; color: var(--cb-sidebar-foreground); overflow: hidden; position: relative; }
        .cb-next-card::after { background: radial-gradient(circle, rgba(213,19,82,.35), transparent 62%); content: ""; height: 14rem; position: absolute; right: -5rem; top: -6rem; width: 14rem; }
        .cb-next-card > * { position: relative; z-index: 1; }
        .cb-next-card .cb-panel-head { border-bottom-color: rgba(248,245,238,.14); }
        .cb-next-card .cb-panel-eyebrow { color: rgba(248,245,238,.54); }
        .cb-next-card .cb-panel-count { color: #ef6b96; }
        .cb-next-copy { padding: 1.1rem 1.25rem 1.25rem; }
        .cb-next-name { font-size: 1.25rem; font-weight: 800; letter-spacing: -.04em; }
        .cb-next-meta { color: rgba(248,245,238,.62); font-size: .72rem; line-height: 1.5; margin-top: .45rem; }
        .cb-next-meta strong { color: var(--cb-sidebar-foreground); }
        .cb-next-link { align-items: center; background: rgba(248,245,238,.1); border: 1px solid rgba(248,245,238,.15); border-radius: .55rem; color: var(--cb-sidebar-foreground); cursor: pointer; display: inline-flex; font-size: .7rem; font-weight: 800; gap: .4rem; margin-top: 1rem; padding: .55rem .65rem; transition: background 150ms; }
        .cb-next-link:hover { background: rgba(248,245,238,.17); }
        .cb-signal { padding: 1.1rem 1.25rem; }
        .cb-signal-row { align-items: center; display: flex; gap: .75rem; }
        .cb-signal-icon { align-items: center; background: #faecd9; border-radius: .6rem; color: #a66845; display: flex; height: 2rem; justify-content: center; width: 2rem; }
        .cb-signal-title { font-size: .76rem; font-weight: 800; }
        .cb-signal-copy { color: var(--cb-muted); font-size: .7rem; line-height: 1.45; margin: .35rem 0 0 2.75rem; }
        .cb-action-message { align-items: center; background: #eaf4ed; border: 1px solid #b9d2c5; border-radius: .7rem; color: #356357; display: flex; font-size: .72rem; font-weight: 800; gap: .5rem; margin: 1rem auto 0; max-width: 72rem; padding: .7rem .85rem; }
        .cb-footer { align-items: center; color: #87989a; display: flex; font-family: "Geist Mono", ui-monospace, monospace; font-size: .59rem; justify-content: space-between; letter-spacing: .06em; margin: 2rem auto 0; max-width: 72rem; text-transform: uppercase; }
        .cb-footer strong { color: #397064; font-weight: 700; }
        @media (max-width: 860px) {
          .cb-shell { grid-template-columns: 15.5rem minmax(0,1fr); }
          .cb-rail { padding: 1.1rem; }
          .cb-workspace-detail { display: none; }
          .cb-intro { align-items: start; flex-direction: column; margin-top: 3.2rem; }
          .cb-grid { grid-template-columns: 1fr; }
          .cb-side { grid-template-columns: repeat(2, minmax(0,1fr)); }
        }
        @media (max-width: 620px) {
          .cb-shell { display: block; }
          .cb-rail { min-height: auto; padding: .8rem 1rem; }
          .cb-rail-rule, .cb-rail-bottom, .cb-rail-label, .cb-workspace-list { display: none; }
          .cb-rail[data-mobile-open="true"] { padding-bottom: 1rem; }
          .cb-rail[data-mobile-open="true"] .cb-rail-label, .cb-rail[data-mobile-open="true"] .cb-workspace-list { display: block; }
          .cb-rail[data-mobile-open="true"] .cb-workspace-list { margin-top: .75rem; }
          .cb-rail[data-mobile-open="true"] .cb-workspace-button { grid-template-columns: 2rem minmax(0,1fr) auto; }
          .cb-mobile-menu { align-items: center; background: transparent; border: 1px solid rgba(248,245,238,.24); border-radius: .5rem; color: var(--cb-sidebar-foreground); cursor: pointer; display: inline-flex; height: 2.25rem; justify-content: center; width: 2.25rem; }
          .cb-brand { justify-content: space-between; }
          .cb-brand > div { margin-right: auto; }
          .cb-main { padding: 1rem; }
          .cb-breadcrumb { font-size: .65rem; }
          .cb-top-actions { gap: .4rem; }
          .cb-intro { gap: 1.25rem; margin: 2.6rem 0 1.75rem; }
          .cb-title { font-size: clamp(2.15rem, 12vw, 3.15rem); }
          .cb-continue { width: 100%; justify-content: center; }
          .cb-side { grid-template-columns: 1fr; }
          .cb-footer { align-items: flex-start; flex-direction: column; gap: .45rem; margin-top: 1.5rem; }
        }
      `}</style>

      <div className="cb-shell">
        <aside className="cb-rail" data-mobile-open={mobileNavOpen}>
          <div className="cb-brand">
            <span className="cb-brand-mark" aria-hidden="true">AZ</span>
            <div>
              <div className="cb-brand-name">AdventureZone</div>
              <span className="cb-brand-subtitle">Command Board</span>
            </div>
            <button
              aria-expanded={mobileNavOpen}
              aria-label="Toggle workspace navigation"
              className="cb-mobile-menu"
              onClick={() => setMobileNavOpen((open) => !open)}
              type="button"
            >
              {mobileNavOpen ? <X aria-hidden="true" size={16} /> : <Menu aria-hidden="true" size={16} />}
            </button>
          </div>

          <div className="cb-rail-rule" />
          <div className="cb-rail-label">Choose a workspace</div>
          <nav aria-label="Workspace selection" className="cb-workspace-list">
            {workspaces.map(({ id, label, shortLabel, detail, eyebrow, icon: Icon, count }) => {
              const active = selectedWorkspace === id;
              return (
                <button
                  aria-current={active ? "page" : undefined}
                  aria-label={`${label}, ${count} items ready`}
                  className="cb-workspace-button"
                  data-active={active}
                  key={id}
                  onClick={() => chooseWorkspace(id)}
                  type="button"
                >
                  <span className="cb-workspace-icon"><Icon aria-hidden="true" size={17} strokeWidth={1.8} /></span>
                  <span className="cb-workspace-copy">
                    <span className="cb-workspace-eyebrow">{eyebrow}</span>
                    <span className="cb-workspace-label">{label}</span>
                    <span className="cb-workspace-detail">{detail}</span>
                  </span>
                  <span className="cb-workspace-count">{count}</span>
                </button>
              );
            })}
          </nav>

          <div className="cb-rail-bottom">
            <div className="cb-system-status">
              <span className="cb-status-dot" aria-hidden="true" />
              <div><strong>System ready</strong><span>All operational surfaces are synced.</span></div>
            </div>
          </div>
        </aside>

        <section className="cb-main">
          <header className="cb-topbar">
            <div className="cb-breadcrumb"><span>Command Board</span><ChevronRight aria-hidden="true" size={13} /><strong>{activeWorkspace.shortLabel}</strong></div>
            <div className="cb-top-actions">
              <span className="cb-status-dot" aria-label="System ready" title="System ready" />
              <div className="cb-admin-wrap">
                <button
                  aria-expanded={adminOpen}
                  aria-label="Open administrator access"
                  className="cb-top-action"
                  data-active={adminOpen}
                  onClick={() => setAdminOpen((open) => !open)}
                  title="Administrator access"
                  type="button"
                >
                  <Shield aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
                {adminOpen ? (
                  <div className="cb-admin-popover" role="status">
                    <strong>Administrator access</strong>
                    <p>Maintenance tools are available from the command terminal.</p>
                    <button className="cb-dismiss" onClick={() => setAdminOpen(false)} type="button">Dismiss</button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div className="cb-intro">
            <div>
              <div className="cb-kicker"><span className="cb-kicker-line" aria-hidden="true" />Workspace launchpad</div>
              <h1 className="cb-title">Start with what needs <em>you.</em></h1>
              <p className="cb-intro-copy">A focused command board for {activeWorkspace.label.toLowerCase()}. Choose a workspace on the left, then pick up the next useful action.</p>
            </div>
            <button className="cb-continue" onClick={() => setActionMessage(`Opening ${activeWorkspace.label}.`)} type="button">
              Continue to {activeWorkspace.shortLabel}
              <ArrowRight aria-hidden="true" size={15} />
            </button>
          </div>

          <div className="cb-grid">
            <section aria-labelledby="queue-title" className="cb-panel">
              <div className="cb-panel-head">
                <div><div className="cb-panel-eyebrow">Action queue</div><h2 className="cb-panel-title" id="queue-title">Your next moves</h2></div>
                <span className="cb-panel-count">{String(pendingCount).padStart(2, "0")} open</span>
              </div>
              <div className="cb-queue">
                {activeQueue.map((item) => {
                  const complete = completedItems.includes(item.id);
                  const Icon = item.icon;
                  return (
                    <div className="cb-queue-item" data-complete={complete} key={item.id}>
                      <span className="cb-queue-icon" data-tone={item.tone}><Icon aria-hidden="true" size={16} strokeWidth={1.8} /></span>
                      <span><span className="cb-queue-label">{item.label}</span><span className="cb-queue-detail">{item.detail}</span></span>
                      <button aria-label={complete ? `${item.label} complete` : `Mark ${item.label} complete`} className="cb-done" data-complete={complete} onClick={() => completeItem(item)} type="button">
                        <Check aria-hidden="true" size={13} />{complete ? "Done" : "Complete"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="cb-side">
              <section aria-labelledby="next-title" className="cb-panel cb-next-card">
                <div className="cb-panel-head">
                  <div><div className="cb-panel-eyebrow">Coming up</div><h2 className="cb-panel-title" id="next-title">Next event</h2></div>
                  <span className="cb-panel-count">01</span>
                </div>
                <div className="cb-next-copy">
                  <div className="cb-next-name">{selectedWorkspace === "office" ? "Summit Week 2025" : "Summit Week check-in"}</div>
                  <div className="cb-next-meta"><strong>{selectedWorkspace === "office" ? "Jul 18 · Estes Park, CO" : "Today · Estes Park, CO"}</strong><br />Keep the handoff clear before the next stop.</div>
                  <button className="cb-next-link" onClick={() => setActionMessage("Event brief opened.")} type="button">Open event brief <ArrowRight aria-hidden="true" size={13} /></button>
                </div>
              </section>

              <section aria-labelledby="signal-title" className="cb-panel cb-signal">
                <div className="cb-signal-row">
                  <span className="cb-signal-icon"><Clock3 aria-hidden="true" size={16} /></span>
                  <div><div className="cb-panel-eyebrow">Stay oriented</div><h2 className="cb-signal-title" id="signal-title">One clear starting point</h2></div>
                </div>
                <p className="cb-signal-copy">Your {activeWorkspace.meta.toLowerCase()} are grouped here so the day can move forward without extra searching.</p>
              </section>
            </div>
          </div>

          {actionMessage ? <div className="cb-action-message" role="status"><Sparkles aria-hidden="true" size={14} />{actionMessage}</div> : null}

          <footer className="cb-footer"><span>AdventureZone Command Board</span><strong><CircleHelp aria-hidden="true" size={12} /> &nbsp;Help is always nearby</strong></footer>
        </section>
      </div>
    </main>
  );
}