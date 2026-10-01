import { useEffect, useState } from 'react';
const listeners = new Set<(bookingId: string) => void>();
/** '*' invalidates all bookings when an existing action only returns a request ID. */
export function notifyBookingOperationsChanged(bookingId: string): void {
  for (const listener of [...listeners]) {
    // An observer must not turn a successful canonical save into a save error.
    try { listener(bookingId); } catch { /* The consumer can retry its own read. */ }
  }
}
export function subscribeBookingOperationsChanges(listener: (bookingId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useBookingOperationsRevision(bookingId?: string | null): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const dispose = subscribeBookingOperationsChanges(id => { if (!bookingId || id === '*' || id === bookingId) refresh(); });
    window.addEventListener('focus', refresh);
    return () => { dispose(); window.removeEventListener('focus', refresh); };
  }, [bookingId]);
  return revision;
}
