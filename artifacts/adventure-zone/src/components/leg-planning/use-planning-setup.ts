import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanningClient } from "@/features/leg-planning/planning-client";
import { useBookingOperationsRevision } from "@/features/bookings/booking-operations-changes";
/** Keep setup forms on their selected identity while background reads refresh. */
export function usePlanningSetup<T>(
  key: string,
  client: PlanningClient,
  load: () => Promise<T>,
) {
  const loader = useRef(load);
  loader.current = load;
  const current = useRef({ key, client });
  current.current = { key, client };
  const generation = useRef(0),
    [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    revision = useBookingOperationsRevision();
  const reload = useCallback(async () => {
    const n = ++generation.current;
    try {
      const result = await loader.current();
      if (n === generation.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (n === generation.current)
        setError(e instanceof Error ? e.message : "Planning unavailable");
    }
  }, [key, client]);
  useEffect(() => {
    setData(null);
    setError("");
    setBusy(false);
    void reload();
    return () => {
      generation.current++;
    };
  }, [reload]);
  useEffect(() => {
    if (revision) void reload();
  }, [revision, reload]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = await work();
      if (current.current.key === key && current.current.client === client)
        await reload();
      return result;
    } catch (e) {
      if (current.current.key === key)
        setError(e instanceof Error ? e.message : "Could not save");
      return undefined;
    } finally {
      if (current.current.key === key) setBusy(false);
    }
  };
  return { data, error, busy, run, reload };
}
