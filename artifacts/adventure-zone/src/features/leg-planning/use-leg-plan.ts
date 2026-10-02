import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanDraft, PlanningRead } from "@workspace/api-zod";
import {
  usePlanningClient,
  requestKey,
  type PlanningClient,
  type PlanningRole,
} from "./planning-client";
import { useBookingOperationsRevision } from "@/features/bookings/booking-operations-changes";
export function useLegPlan(
  bookingId: string,
  role: PlanningRole,
  override?: PlanningClient,
) {
  const client = usePlanningClient(role, override),
    revision = useBookingOperationsRevision(bookingId);
  const [data, setData] = useState<PlanningRead | null>(null),
    [draft, setDraft] = useState<PlanDraft | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [dirty, setDirty] = useState(false);
  const current = useRef({ bookingId, client });
  current.current = { bookingId, client };
  const generation = useRef(0),
    selectionEpoch = useRef(0),
    changes = useRef(0),
    dirtyRef = useRef(false),
    draftRef = useRef(draft),
    dataRef = useRef(data),
    baseRevision = useRef<number | null>(null),
    pending = useRef<{ body: string; key: string } | null>(null);
  draftRef.current = draft;
  dataRef.current = data;
  const reload = useCallback(async () => {
    const n = ++generation.current;
    setLoading(true);
    try {
      const r = await client.read(bookingId);
      if (n === generation.current && current.current.bookingId === bookingId) {
        setData(r);
        if (!dirtyRef.current) setDraft(r.plan?.draft ?? r.draft ?? null);
        setError("");
      }
    } catch (e) {
      if (n === generation.current)
        setError(e instanceof Error ? e.message : "Could not load planning");
    } finally {
      if (n === generation.current) setLoading(false);
    }
  }, [bookingId, client]);
  useEffect(() => {
    selectionEpoch.current++;
    generation.current++;
    changes.current++;
    dirtyRef.current = false;
    pending.current = null;
    setDirty(false);
    setData(null);
    setDraft(null);
    setError("");
    setBusy(false);
    void reload();
    return () => {
      generation.current++;
    };
  }, [bookingId, client]);
  useEffect(() => {
    if (revision) void reload();
  }, [revision, reload]);
  const edit = useCallback((p: PlanDraft) => {
    if (p.bookingId !== current.current.bookingId) return;
    if (!dirtyRef.current)
      baseRevision.current = dataRef.current?.plan?.revision ?? null;
    changes.current++;
    dirtyRef.current = true;
    draftRef.current = p;
    setDraft(p);
    setDirty(true);
  }, []);
  const save = async () => {
    const epoch = selectionEpoch.current;
    const p = draftRef.current;
    if (!p || p.bookingId !== bookingId) return;
    const at = changes.current;
    const expected = dirtyRef.current
      ? baseRevision.current
      : (dataRef.current?.plan?.revision ?? null);
    const body = JSON.stringify({ p, expected });
    if (pending.current?.body !== body)
      pending.current = { body, key: requestKey() };
    setBusy(true);
    setError("");
    try {
      const r = await client.save(p, expected, pending.current.key);
      if (
        current.current.bookingId === bookingId &&
        current.current.client === client &&
        selectionEpoch.current === epoch
      ) {
        pending.current = null;
        baseRevision.current = r.value.revision;
        if (changes.current === at) {
          dirtyRef.current = false;
          setDirty(false);
          setDraft(r.value.draft);
        }
        setData((v) => (v ? { ...v, plan: r.value } : v));
        await reload();
      }
      return r;
    } catch (e) {
      if (
        current.current.bookingId === bookingId &&
        selectionEpoch.current === epoch
      )
        setError(e instanceof Error ? e.message : "Draft not saved");
      return undefined;
    } finally {
      if (
        current.current.bookingId === bookingId &&
        selectionEpoch.current === epoch
      )
        setBusy(false);
    }
  };
  const perform = async (work: () => Promise<unknown>) => {
    const epoch = selectionEpoch.current;
    setBusy(true);
    setError("");
    try {
      const r = await work();
      if (
        current.current.bookingId === bookingId &&
        selectionEpoch.current === epoch
      )
        await reload();
      return r;
    } catch (e) {
      if (
        current.current.bookingId === bookingId &&
        selectionEpoch.current === epoch
      )
        setError(e instanceof Error ? e.message : "Planning action failed");
      return undefined;
    } finally {
      if (
        current.current.bookingId === bookingId &&
        selectionEpoch.current === epoch
      )
        setBusy(false);
    }
  };
  const discard = () => {
    dirtyRef.current = false;
    setDirty(false);
    changes.current++;
    setDraft(data?.plan?.draft ?? data?.draft ?? null);
  };
  return {
    data:
      data?.draft?.bookingId === bookingId ||
      data?.plan?.bookingId === bookingId
        ? data
        : null,
    draft: draft?.bookingId === bookingId ? draft : null,
    error,
    busy,
    loading,
    revisionChanged:
      dirty && (data?.plan?.revision ?? null) !== baseRevision.current,
    dirty,
    edit,
    save,
    reload,
    discard,
    perform,
    client,
  };
}
