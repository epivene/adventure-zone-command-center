import { Router, type IRouter } from "express";
import { getMapEvents, type MapFilters } from "@/features/routes/map-query";

const router: IRouter = Router();

const allEvents: MapFilters = {
  statuses: [],
  travelLegIds: [],
  dateFrom: null,
  dateTo: null,
  regions: [],
};

router.get("/calendar", async (req, res): Promise<void> => {
  try {
    const events = await getMapEvents(allEvents);
    res.json(events);
  } catch (err) {
    req.log.error({ err }, "Failed to load calendar");
    res.status(500).json({ error: "Failed to load calendar" });
  }
});

export default router;
