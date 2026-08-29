import { useCallback, useEffect, useState } from "react";
import { managerScopedMapResponseSchema, type ManagerScopedMapResponse } from "@workspace/api-zod";
import { useManagerAuth } from "@/lib/manager-auth-context";
import type { ManagerScopedMapData } from "./manager-map-types";

type WireData = ManagerScopedMapResponse;

function normalize(data: WireData): ManagerScopedMapData {
  return {
    ...data,
    route: data.route ? {
      ...data.route,
      stops: data.route.stops.map((stop) => ({ ...stop, startsAt: stop.startsAt ? new Date(stop.startsAt) : null, endsAt: stop.endsAt ? new Date(stop.endsAt) : null })),
    } : null,
    events: data.events.map((event) => ({ ...event, startsAt: event.startsAt ? new Date(event.startsAt) : null, endsAt: event.endsAt ? new Date(event.endsAt) : null })),
    meetups: data.meetups.map((meetup) => ({ ...meetup, windowStartsAt: new Date(meetup.windowStartsAt), windowEndsAt: new Date(meetup.windowEndsAt) })),
  };
}

export function useManagerScopedMap() {
  const { managerApi } = useManagerAuth();
  const [data, setData] = useState<ManagerScopedMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = managerScopedMapResponseSchema.parse(await managerApi<unknown>("/manager/map"));
      setData(normalize(payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load manager map");
    } finally {
      setLoading(false);
    }
  }, [managerApi]);

  useEffect(() => { void reload(); }, [reload]);

  return { data, loading, error, reload };
}
