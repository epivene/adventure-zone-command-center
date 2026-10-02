import { useCallback, useEffect, useRef, useState } from "react";
import { useBookingOperationsRevision } from '@/features/bookings/booking-operations-changes';
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
  const revision = useBookingOperationsRevision();
  const readGeneration = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++readGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const payload = managerScopedMapResponseSchema.parse(await managerApi<unknown>("/manager/map"));
      if (generation !== readGeneration.current) return;
      setData(normalize(payload));
    } catch (e) {
      if (generation === readGeneration.current) setError(e instanceof Error ? e.message : "Could not load manager map");
    } finally {
      if (generation === readGeneration.current) setLoading(false);
    }
  }, [managerApi]);

  useEffect(() => { void reload(); return () => { readGeneration.current++; }; }, [reload, revision]);

  return { data, loading, error, reload };
}
