import { Router, type IRouter, type RequestHandler } from 'express';
import { z } from 'zod';
import type { OperationsViewer } from '@workspace/api-zod';
import type { BookingLegOperationsService } from '@/features/bookings/booking-leg-operations-service';
import { OperationsAccessError } from '@/features/bookings/booking-leg-operations-repository';

export function createBookingLegOperationsRouter(dependencies: { service: BookingLegOperationsService; requireOwner: RequestHandler; requireBoss: RequestHandler; requireManager: RequestHandler }): IRouter {
  const router = Router();
  const id = z.string().uuid();
  for (const role of ['owner', 'boss', 'manager'] as const) {
    const prefix = role === 'owner' ? '' : `/${role}`;
    const auth = role === 'owner' ? dependencies.requireOwner : role === 'boss' ? dependencies.requireBoss : dependencies.requireManager;
    router.get(`${prefix}/bookings/:id/leg-operations`, auth, async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      if (!id.safeParse(req.params.id).success) { res.status(400).json({ error: 'Choose a valid booking.' }); return; }
      const viewer: OperationsViewer = role === 'manager' ? { kind: 'manager', legId: req.legManager!.legId } : { kind: role };
      try {
        const result = await dependencies.service.get(String(req.params.id), viewer);
        if (!result) { res.status(404).json({ error: 'Booking not found.' }); return; }
        if (req.query.profileId && result.profileId !== req.query.profileId) { res.status(409).json({ error: 'This booking belongs to another profile.' }); return; }
        res.json(result);
      } catch (error) { next(error); }
    });
    if (role === 'manager') continue;
    const profilePath = role === 'owner' ? '/event-profiles' : '/boss/profiles';
    router.get(`${profilePath}/:profileId/leg-operations-bookings`, auth, async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      if (!id.safeParse(req.params.profileId).success) { res.status(400).json({ error: 'Choose a valid profile.' }); return; }
      try { res.json({ bookings: await dependencies.service.listProfileBookings(String(req.params.profileId), { kind: role }) }); } catch (error) { next(error); }
    });
  }
  router.use(((error, _req, res, _next) => {
    if (error instanceof OperationsAccessError) { res.status(error.status).json({ error: error.message }); return; }
    res.status(503).json({ error: 'Operations details are unavailable. Retry to check the saved records.' });
  }) as import('express').ErrorRequestHandler);
  return router;
}
