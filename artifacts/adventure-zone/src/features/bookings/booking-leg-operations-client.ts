import { bookingLegOperationsSchema, operationsBookingOptionSchema, type BookingLegOperations, type OperationsBookingOption } from '@workspace/api-zod';
import { apiGet } from '@/lib/auth-token';
import { bossGet } from '@/lib/boss-auth-context';
export type OperationsReadClient = { getBooking(id: string): Promise<BookingLegOperations>; listProfileBookings(id: string): Promise<OperationsBookingOption[]> };
export function createOperationsReadClient(get: <T>(path: string) => Promise<T>, role: 'owner' | 'boss' | 'manager'): OperationsReadClient {
  const prefix = role === 'owner' ? '' : `/${role}`;
  return {
    async getBooking(id) { return bookingLegOperationsSchema.parse(await get(`${prefix}/bookings/${encodeURIComponent(id)}/leg-operations`)); },
    async listProfileBookings(id) {
      const path = role === 'owner' ? '/event-profiles' : '/boss/profiles';
      const result = await get<{ bookings: unknown[] }>(`${path}/${encodeURIComponent(id)}/leg-operations-bookings`);
      return operationsBookingOptionSchema.array().parse(result.bookings);
    },
  };
}
export const ownerOperationsClient = createOperationsReadClient(apiGet, 'owner');
export const bossOperationsClient = createOperationsReadClient(bossGet, 'boss');
