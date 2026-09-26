import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { Conversation } from "@/features/assistant-workspace/types";
import { prepareOfflineWorkspace } from "@/features/assistant-workspace/offline-prepare";
import {
  loadOfflineWorkspace,
  type OfflineSnapshot,
} from "@/features/assistant-workspace/offline-store";
import { isOfflineShellReady } from "@/lib/offline/workspace-shell";
import { onAuthChange } from "@/lib/auth-token";
export function OfflinePreparation({
  conversation,
  busy = false,
}: {
  conversation: Conversation | null;
  busy?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [missingShell, setMissingShell] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const operation = useRef(0);
  useEffect(() => {
    const generation = ++operation.current;
    setSnapshot(null);
    setError("");
    setMissingShell(false);
    setPreparing(false);
    if (conversation)
      void Promise.all([loadOfflineWorkspace(), isOfflineShellReady()])
        .then(([saved, ready]) => {
          if (operation.current !== generation) return;
          const current = saved.snapshots.find(
            (entry) => entry.conversation.id === conversation.id,
          );
          if (current && ready) setSnapshot(current);
          else if (current) setMissingShell(true);
        })
        .catch(() => {
          if (operation.current === generation)
            setError(
              "Saved offline readiness could not be checked. Prepare again while connected.",
            );
        });
    return () => {
      operation.current++;
    };
  }, [conversation?.id]);
  useEffect(() => {
    const connectivity = () => setOnline(navigator.onLine);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    const unsubscribe = onAuthChange(() => {
      operation.current++;
      setSnapshot(null);
      setMissingShell(false);
      setPreparing(false);
    });
    return () => {
      unsubscribe();
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
    };
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setTimeout(
      () => setSnapshot(null),
      Math.max(0, snapshot.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [snapshot]);
  async function prepare() {
    if (!conversation || preparing || busy || !online) return;
    const generation = ++operation.current;
    setPreparing(true);
    setError("");
    setSnapshot(null);
    setMissingShell(false);
    try {
      const result = await prepareOfflineWorkspace(
        conversation.id,
        (message) => {
          if (operation.current === generation) setProgress(message);
        },
      );
      if (operation.current === generation) setSnapshot(result);
    } catch (cause) {
      if (operation.current === generation)
        setError(
          cause instanceof Error
            ? cause.message
            : "This device could not be prepared. Try again online.",
        );
    } finally {
      if (operation.current === generation) {
        setPreparing(false);
        setProgress("");
      }
    }
  }
  return (
    <section
      aria-label="Offline preparation"
      className="space-y-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={!conversation || busy || preparing || !online}
          className="min-h-11 rounded-lg bg-teal-800 px-3 py-2 font-semibold text-white disabled:opacity-50"
        >
          {preparing
            ? "Preparing this device…"
            : snapshot
              ? "Refresh offline copy"
              : "Prepare for offline"}
        </button>
        <Link
          href="/assistant/offline"
          className="inline-flex min-h-11 items-center rounded-lg border border-teal-700 bg-white px-3 py-2 font-medium text-teal-900"
        >
          Open saved workspace
        </Link>
      </div>
      {snapshot && (
        <p role="status">
          Ready on this device · saved{" "}
          {new Date(snapshot.preparedAt).toLocaleString()}. Available until{" "}
          {new Date(snapshot.expiresAt).toLocaleString()}.
        </p>
      )}
      {progress && <p role="status">{progress}</p>}
      {missingShell && (
        <p role="status">
          Saved records remain, but app files are missing. Prepare again before
          going offline.
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      {!online && <p>Connect to prepare or refresh saved records.</p>}
      <p className="text-slate-700">
        Saves this conversation, selected profile summaries, business rules and
        drafts for up to 7 days. Local draft edits stay in place. AI needs
        internet; document and image files are not downloaded.
      </p>
    </section>
  );
}
