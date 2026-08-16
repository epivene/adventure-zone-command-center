import { useCallback, useEffect, useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import type { ManagerScopedMapData } from "./manager-map-types";

type WireData = Omit<ManagerScopedMapData, "route" | "events" | "meetups"> & {
  route: null | (Omit<NonNullable<ManagerScopedMapData["route"]>, "stops"> & {
    stops: Array<Omit<NonNullable<ManagerScopedMapData["route"]>["stops"][number], "startsAt" | "endsAt"> & { startsAt: string | null; endsAt: string | null }>;
  });
  events: Array<Omit<ManagerScopedMapData["events"][number], "startsAt" | "endsAt"> & { startsAt: string | null; endsAt: string | null }>;
  meetups: Array<Omit<ManagerScopedMapData["meetups"][number], "windowStartsAt" | "windowEndsAt"> & { windowStartsAt: string; windowEndsAt: string }>;
};

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
      setData(normalize(await managerApi<WireData>("/manager/map")));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load manager map");
    } finally {
      setLoading(false);
    }
  }, [managerApi]);

  useEffect(() => { void reload(); }, [reload]);

  return { data, loading, error, reload };
}
