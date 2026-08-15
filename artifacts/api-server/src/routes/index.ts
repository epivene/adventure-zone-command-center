import { Router, type IRouter } from "express";
import healthRouter from "./health";
import todayRouter from "./today";
import bookingsRouter from "./bookings";
import contactsRouter from "./contacts";
import organizationsRouter from "./organizations";
import calendarRouter from "./calendar";
import routesMapRouter from "./routes-map";
import tripsRouter from "./trips";
import activitiesRouter from "./activities";
import callsRouter from "./calls";
import eventProfilesRouter from "./event-profiles";
import eventFamiliesRouter from "./event-families";
import settingsRouter from "./settings";
import actMigrationRouter from "./act-migration";
import actReplacementRouter from "./act-replacement";
import aiSuggestionsRouter from "./ai-suggestions";
import followUpsRouter from "./follow-ups";
import authRouter from "./auth";
import managerAuthRouter from "./leg-manager-auth";
import managerRouter from "./leg-manager";
import managerAdminRouter from "./leg-manager-admin";
import { requireOwnerMiddleware } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
// Owner login and manager login/data routes are mounted before the owner
// middleware. Manager data routes enforce their own manager-session middleware.
router.use(authRouter);
router.use(managerAuthRouter);
router.use(managerRouter);

// Owner-only app and manager-admin routes require the owner's bearer token.
router.use(requireOwnerMiddleware);
router.use(managerAdminRouter);
router.use(todayRouter);
router.use(bookingsRouter);
router.use(contactsRouter);
router.use(organizationsRouter);
router.use(calendarRouter);
router.use(routesMapRouter);
router.use(tripsRouter);
router.use(activitiesRouter);
router.use(callsRouter);
router.use(eventProfilesRouter);
router.use(eventFamiliesRouter);
router.use(settingsRouter);
router.use(actReplacementRouter);
router.use(actMigrationRouter);
router.use(aiSuggestionsRouter);
router.use("/follow-ups", followUpsRouter);

export default router;