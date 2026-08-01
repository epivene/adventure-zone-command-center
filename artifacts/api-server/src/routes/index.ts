import { Router, type IRouter } from "express";
import healthRouter from "./health";
import todayRouter from "./today";
import bookingsRouter from "./bookings";
import contactsRouter from "./contacts";
import organizationsRouter from "./organizations";
import calendarRouter from "./calendar";
import routesMapRouter from "./routes-map";
import activitiesRouter from "./activities";
import callsRouter from "./calls";
import eventProfilesRouter from "./event-profiles";
import settingsRouter from "./settings";
import authRouter from "./auth";
import { requireOwnerMiddleware } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
// Auth routes are mounted before the owner middleware; login is public and
// /auth/me enforces auth itself.
router.use(authRouter);

// All other app routes require the owner's bearer token
router.use(requireOwnerMiddleware);
router.use(todayRouter);
router.use(bookingsRouter);
router.use(contactsRouter);
router.use(organizationsRouter);
router.use(calendarRouter);
router.use(routesMapRouter);
router.use(activitiesRouter);
router.use(callsRouter);
router.use(eventProfilesRouter);
router.use(settingsRouter);

export default router;
