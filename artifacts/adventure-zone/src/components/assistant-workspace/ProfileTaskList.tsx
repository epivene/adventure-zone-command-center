import { useEffect, useRef, useState } from "react";
import { workspaceApi } from "@/features/assistant-workspace/api";
import type {
  ProfileTask,
  ProfileTaskCommand,
  ProfileTaskChange,
} from "@/features/assistant-workspace/types";
import { ProfileTaskCard } from "./ProfileTaskCard";
import { ProfileTaskReview } from "./ProfileTaskReview";
const noTasks: ProfileTask[] = [];
export function ProfileTaskList({
  conversationId,
  initialTasks = noTasks,
  offline: externalOffline = false,
  readOnly = false,
  onChanged,
}: {
  conversationId: string;
  initialTasks?: ProfileTask[];
  offline?: boolean;
  readOnly?: boolean;
  onChanged?: () => Promise<void>;
}) {
  const [connected, setConnected] = useState(navigator.onLine);
  useEffect(() => {
    const changed = () => setConnected(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  const offline = externalOffline || !connected;
  const [tasks, setTasks] = useState(initialTasks),
    [review, setReview] = useState<string | null>(null),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);
  useEffect(() => {
    let live = true;
    const version = ++generation.current;
    const controller = new AbortController();
    async function load() {
      if (offline) return;
      try {
        const next = await workspaceApi<ProfileTask[]>(
          `/tasks?conversationId=${conversationId}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (live && generation.current === version) {
          setTasks(next);
          setError("");
        }
      } catch {
        if (live && !controller.signal.aborted)
          setError("Progress could not refresh. Showing last-known state.");
      }
    }
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [conversationId, offline]);
  async function refresh() {
    setTasks(
      await workspaceApi<ProfileTask[]>(
        `/tasks?conversationId=${conversationId}`,
      ),
    );
    await onChanged?.();
  }
  async function command(
    task: ProfileTask,
    command: ProfileTaskCommand,
    itemIds?: string[],
    options?: {
      completionMode?: "manual" | "sourced_notes" | "profile_fields";
    },
  ) {
    if (offline || readOnly || !navigator.onLine) throw Error("OFFLINE");
    try {
      await workspaceApi(`/tasks/${task.id}/commands`, "POST", {
        requestKey: crypto.randomUUID(),
        expectedVersion: task.version,
        command,
        itemIds,
        ...options,
      });
    } finally {
      await refresh();
    }
  }
  async function approve(task: ProfileTask, changes: ProfileTaskChange[]) {
    if (offline || readOnly || !navigator.onLine) throw Error("OFFLINE");
    try {
      const r = await workspaceApi<{ results: { status: string }[] }>(
        `/tasks/${task.id}/approvals`,
        "POST",
        {
          requestKey: crypto.randomUUID(),
          expectedVersion: task.version,
          actions: changes.map((c) => ({
            id: c.actionId,
            revision: c.revision,
          })),
        },
      );
      if (r.results.some((r) => r.status !== "ok"))
        throw Error("ASSISTANT_TASK_CONFLICT");
    } finally {
      await refresh();
    }
  }
  return (
    <div className="min-w-0 space-y-3" aria-label="Profile tasks">
      {tasks.length > 1 && (
        <p className="text-sm">Choose a task below to resume or review.</p>
      )}
      {error && <p role="status">{error}</p>}
      {tasks.map((task) => (
        <div key={task.id} className="min-w-0 space-y-2">
          <ProfileTaskCard
            task={task}
            offline={offline || !!error}
            readOnly={readOnly}
            onCommand={(c, ids, options) => command(task, c, ids, options)}
            onReview={async () =>
              setReview(review === task.id ? null : task.id)
            }
          />
          {review === task.id && (
            <ProfileTaskReview
              taskId={task.id}
              changes={task.changes ?? []}
              disabled={offline || readOnly || !!error}
              onApprove={(changes) => approve(task, changes)}
              onSkip={(ids) => command(task, "skip", ids)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
