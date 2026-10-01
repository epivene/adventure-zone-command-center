import type { OperationsBookingOption } from '@workspace/api-zod';
export function selectProfileOperationsBooking(options: OperationsBookingOption[], season: number, requestedId?: string | null): { kind: 'selected'; booking: OperationsBookingOption } | { kind: 'invalid' | 'choose' | 'empty' } {
  if (requestedId) {
    const booking = options.find(item => item.id === requestedId);
    return booking && (booking.seasonYear === null || booking.seasonYear === season) ? { kind: 'selected', booking } : { kind: 'invalid' };
  }
  const candidates = options.filter(item => item.seasonYear === season);
  return candidates.length === 1 ? { kind: 'selected', booking: candidates[0] } : { kind: candidates.length ? 'choose' : 'empty' };
}
export function currentOperationsSeason(): number { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric' }).format(new Date())); }
