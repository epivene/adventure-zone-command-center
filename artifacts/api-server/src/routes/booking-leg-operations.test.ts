import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createBookingLegOperationsRouter } from './booking-leg-operations';
import { OperationsAccessError } from '@/features/bookings/booking-leg-operations-repository';

const id = 'e19a67ac-3908-4fc1-a165-0a1d2ce7b8ca';
const auth: RequestHandler = (req, res, next) => { if (req.headers.authorization !== 'Bearer allowed') { res.status(401).json({ error: 'Unauthorized' }); return; } req.legManager = { legId: 'angel', managerName: 'Angel' }; next(); };
function app() {
  const a = express();
  a.use(createBookingLegOperationsRouter({ service: {
    get: async (_id: string, viewer: { kind: string }) => { if (viewer.kind === 'manager') throw new OperationsAccessError(403); return { bookingId: id, profileId: null }; },
    listProfileBookings: async () => [],
  } as any, requireOwner: auth, requireBoss: auth, requireManager: auth }));
  return a;
}
it('authenticates all owner boss and manager read endpoints', async () => {
  for (const path of [`/bookings/${id}/leg-operations`, `/boss/bookings/${id}/leg-operations`, `/manager/bookings/${id}/leg-operations`]) expect((await request(app()).get(path)).status).toBe(401);
});
it('keeps manager ownership errors forbidden and owner reads no-store', async () => {
  expect((await request(app()).get(`/manager/bookings/${id}/leg-operations`).set('Authorization', 'Bearer allowed')).status).toBe(403);
  const response = await request(app()).get(`/bookings/${id}/leg-operations`).set('Authorization', 'Bearer allowed');
  expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
});
it('invalid_uuid_and_booking_profile_mismatch', async () => {
  expect((await request(app()).get('/bookings/invalid/leg-operations').set('Authorization', 'Bearer allowed')).status).toBe(400);
  expect((await request(app()).get(`/bookings/${id}/leg-operations?profileId=not-its-profile`).set('Authorization', 'Bearer allowed')).status).toBe(409);
});
it('profile lists cannot be accessed through manager credentials', async () => {
  expect((await request(app()).get(`/event-profiles/${id}/leg-operations-bookings`)).status).toBe(401);
});
