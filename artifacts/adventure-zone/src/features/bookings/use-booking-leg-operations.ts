import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookingLegOperations } from '@workspace/api-zod';
import type { OperationsReadClient } from './booking-leg-operations-client';
import { useBookingOperationsRevision } from './booking-operations-changes';
export function useBookingLegOperations(bookingId: string | null, client: OperationsReadClient) {
  const [data, setData] = useState<BookingLegOperations | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const revision = useBookingOperationsRevision(bookingId);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setError(null);
    if (!bookingId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await client.getBooking(bookingId);
      if (request === generation.current) setData(result);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Operations details could not be loaded.');
    } finally { if (request === generation.current) setLoading(false); }
  }, [bookingId, client]);
  useEffect(() => { setData(null); void reload(); return () => { generation.current++; }; }, [reload]);
  useEffect(() => { if(revision) void reload(); }, [reload, revision]);
  return { data: data?.bookingId === bookingId ? data : null, loading, error, reload };
}
