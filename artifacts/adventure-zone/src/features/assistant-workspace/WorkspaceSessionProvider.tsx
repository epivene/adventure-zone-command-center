import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import ConversationView from "@/components/assistant-workspace/ConversationView";
import { profileSelection } from "./profile-scope";
import { workspaceApi } from "./api";
import { onAuthChange } from "@/lib/auth-token";
import type { Conversation } from "./types";
import type { Selection } from "./types";

type Session = {
  key: string;
  id?: string;
  profileId?: string;
  label?: string;
  returnTo?: string;
  initialSelection?: Selection;
};
type SessionActions = {
  openProfile(id: string, label?: string): Promise<void>;
  openConversation(id?: string): void;
  expand(): void;
  closePanel(): void;
};
const Context = createContext<SessionActions | null>(null);
export function useWorkspaceSession() {
  const value = useContext(Context);
  if (!value) throw new Error("Assistant session provider is missing");
  return value;
}

/** Sessions outlive route changes, so editors and in-flight submissions stay mounted. */
export function WorkspaceSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [location, navigate] = useLocation();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeKey, setActiveKey] = useState<string>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.("(max-width: 1023px)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 1023px)");
    if (!media) return;
    const change = () => setNarrow(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [blocked, setBlocked] = useState<{
    id: string;
    label: string;
    message: string;
  } | null>(null);
  const openSequence = useRef(0);
  const associationKey = "az-assistant-profile-sessions";
  useEffect(
    () =>
      onAuthChange(() => {
        openSequence.current++;
        setSessions([]);
        setActiveKey(undefined);
        setPanelOpen(false);
        setBlocked(null);
        try {
          sessionStorage.removeItem(associationKey);
        } catch {
          /* Optional storage. */
        }
      }),
    [],
  );
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(associationKey) || "{}");
      for (const session of sessions)
        if (session.profileId && session.id)
          saved[session.profileId] = session.id;
      sessionStorage.setItem(associationKey, JSON.stringify(saved));
    } catch {
      /* Conversation history remains available without storage. */
    }
  }, [sessions]);
  const host = useRef<HTMLDivElement>(null),
    opener = useRef<HTMLElement | null>(null);
  const full = /^\/assistant\/workspace(?:\/|$)/.test(location);
  const routeId = full ? location.split("/")[3] : undefined;
  const current = sessions.find((item) => item.key === activeKey);
  function openConversation(id?: string) {
    const existing = sessions.find((item) =>
      id ? item.id === id : item.key === "general",
    );
    const next = existing ?? { key: id ? `conversation:${id}` : "general", id };
    if (!existing) setSessions((items) => [...items, next]);
    setActiveKey(next.key);
    navigate(`/assistant/workspace${id ? `/${id}` : ""}`);
  }
  useEffect(() => {
    if (!full) return;
    if (current && (current.id === routeId || (!routeId && !current.id)))
      return;
    const existing = sessions.find((item) =>
      routeId ? item.id === routeId : item.key === "general",
    );
    const next = existing ?? {
      key: routeId ? `conversation:${routeId}` : "general",
      id: routeId,
    };
    if (!existing) setSessions((items) => [...items, next]);
    setActiveKey(next.key);
  }, [location, full, routeId, current?.id, activeKey]);
  useEffect(() => {
    openSequence.current++;
    if (
      !full &&
      panelOpen &&
      current?.returnTo &&
      location !== current.returnTo.split("?")[0]
    )
      setPanelOpen(false);
  }, [location]);
  async function openProfile(id: string, label = "Selected profile") {
    const sequence = ++openSequence.current;
    opener.current = document.activeElement as HTMLElement;
    setBlocked(null);
    const existing = sessions.find((item) => item.profileId === id);
    if (existing) {
      setActiveKey(existing.key);
      setPanelOpen(true);
      return;
    }
    let savedId: string | undefined;
    try {
      savedId = JSON.parse(sessionStorage.getItem(associationKey) || "{}")[id];
    } catch {
      /* optional */
    }
    if (savedId) {
      try {
        const saved = await workspaceApi<Conversation>(
          `/conversations/${encodeURIComponent(savedId)}`,
        );
        if (sequence !== openSequence.current) return;
        const scope =
          saved.runs.find((run) => ["queued", "running"].includes(run.status))
            ?.selection ?? saved.selection;
        if (
          (saved.lifecycle ?? "active") !== "active" ||
          scope.organizationIds.length !== 1 ||
          scope.organizationIds[0] !== id
        ) {
          setBlocked({
            id,
            label,
            message:
              "The earlier conversation is archived or uses a different profile selection. Start a new profile conversation, or find it in the workspace history.",
          });
          setPanelOpen(true);
          setActiveKey(undefined);
          return;
        }
      } catch {
        if (sequence !== openSequence.current) return;
        setBlocked({
          id,
          label,
          message:
            "The earlier conversation could not be opened. Retry, or start a new profile conversation.",
        });
        setPanelOpen(true);
        setActiveKey(undefined);
        return;
      }
    }
    const associated = savedId
      ? sessions.find((item) => item.id === savedId)
      : undefined;
    if (associated) {
      setSessions((items) =>
        items.map((item) =>
          item.key === associated.key
            ? {
                ...item,
                profileId: id,
                label,
                returnTo: location + window.location.search,
              }
            : item,
        ),
      );
      setActiveKey(associated.key);
      setPanelOpen(true);
      return;
    }
    const key = crypto.randomUUID();
    setSessions((items) => [
      ...items,
      {
        key,
        id: savedId,
        profileId: id,
        label,
        initialSelection: profileSelection(id),
        returnTo: location + window.location.search,
      },
    ]);
    setActiveKey(key);
    setPanelOpen(true);
  }
  function startFresh() {
    if (!blocked) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(associationKey) || "{}");
      delete saved[blocked.id];
      sessionStorage.setItem(associationKey, JSON.stringify(saved));
    } catch {
      /* optional */
    }
    void openProfile(blocked.id, blocked.label);
  }
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!panelOpen && restoreFocus.current) {
      restoreFocus.current = false;
      opener.current?.focus();
    }
  }, [panelOpen]);
  function closePanel() {
    restoreFocus.current = true;
    setPanelOpen(false);
  }
  function expand() {
    navigate(`/assistant/workspace${current?.id ? `/${current.id}` : ""}`);
  }
  function navigateSession(key: string, path: string) {
    const match = /^\/assistant\/workspace(?:\/([^/?]+))?$/.exec(path);
    if (!match) {
      navigate(path);
      return;
    }
    const id = match[1],
      session = sessions.find((item) => item.key === key);
    if (!session?.id && id) {
      setSessions((items) =>
        items.map((item) => (item.key === key ? { ...item, id } : item)),
      );
      if (full) navigate(path);
      return;
    }
    if (id === session?.id) return;
    const existing = sessions.find((item) => item.id === id && !!id);
    const next = existing ?? {
      key: crypto.randomUUID(),
      id,
      returnTo: session?.returnTo,
    };
    if (!existing) setSessions((items) => [...items, next]);
    setActiveKey(next.key);
    if (full) navigate(path);
  }
  useEffect(() => {
    if (!panelOpen || full) return;
    const focus = () =>
      host.current?.querySelector<HTMLElement>("button")?.focus();
    focus();
    function onKey(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        (!(event.target as HTMLElement)?.closest('[role="dialog"]') ||
          (event.target as HTMLElement)?.closest('[role="dialog"]') ===
            host.current)
      ) {
        event.preventDefault();
        closePanel();
      }
      if (
        event.key !== "Tab" ||
        !window.matchMedia?.("(max-width: 1023px)").matches
      )
        return;
      const controls = Array.from(
        host.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]",
        ) ?? [],
      ).filter((el) => el.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen, full, activeKey]);
  return (
    <Context.Provider
      value={{ openProfile, openConversation, expand, closePanel }}
    >
      <div
        inert={!full && panelOpen && narrow ? true : undefined}
        className={!full && panelOpen ? "lg:pr-[min(48vw,720px)]" : undefined}
      >
        {children}
      </div>
      <div
        ref={host}
        hidden={!full && !panelOpen}
        role={!full && panelOpen ? "dialog" : undefined}
        aria-label="Assistant"
        aria-modal={!full && panelOpen && narrow ? true : undefined}
        className={
          full
            ? "fixed inset-x-0 bottom-[calc(73px+max(0.5rem,env(safe-area-inset-bottom)))] top-0 z-20 md:bottom-0 overflow-y-auto overflow-x-hidden bg-background px-3 pb-24 md:top-[64px] md:px-6"
            : "fixed inset-y-0 right-0 z-40 w-full overflow-y-auto overflow-x-hidden border-l bg-background p-3 shadow-xl lg:w-[48vw] lg:max-w-[720px]"
        }
      >
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap gap-2 border-b bg-background py-2">
          {!full ? (
            <>
              <button
                type="button"
                className="button-secondary"
                onClick={closePanel}
              >
                Close assistant
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={expand}
              >
                Open full workspace
              </button>
            </>
          ) : current?.returnTo ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setPanelOpen(true);
                navigate(current.returnTo!);
              }}
            >
              Back to profile
            </button>
          ) : null}
        </div>
        {blocked ? (
          <div role="alert" className="rounded border p-3">
            <p>{blocked.message}</p>
            <div className="mt-3 flex gap-2">
              <button
                className="button-secondary"
                onClick={() => void openProfile(blocked.id, blocked.label)}
              >
                Retry
              </button>
              <button className="button-primary" onClick={startFresh}>
                Start a new profile conversation
              </button>
            </div>
          </div>
        ) : null}
        {sessions.map((session) => (
          <div key={session.key} hidden={session.key !== activeKey}>
            <ConversationView
              conversationId={session.id}
              initialSelection={session.initialSelection}
              scopeLabel={session.label}
              placement={full ? "workspace" : "panel"}
              navigateTo={(path) => navigateSession(session.key, path)}
              onScopeChange={() => {
                if (session.profileId)
                  try {
                    const saved = JSON.parse(
                      sessionStorage.getItem(associationKey) || "{}",
                    );
                    delete saved[session.profileId];
                    sessionStorage.setItem(
                      associationKey,
                      JSON.stringify(saved),
                    );
                  } catch {
                    /* optional */
                  }
                setSessions((items) =>
                  items.map((item) =>
                    item.key === session.key
                      ? { ...item, profileId: undefined }
                      : item,
                  ),
                );
              }}
            />
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}
