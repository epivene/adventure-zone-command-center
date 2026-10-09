import { Router, type IRouter } from "express";
import { z } from "zod";
import { SaveFestivalVenuePinBody, SearchFestivalVenueBody, SearchFestivalNearbyStopsBody, CreateFestivalCrewStopBody, UpdateFestivalCrewStopBody, RemoveFestivalCrewStopBody } from "@workspace/api-zod";
import { requireOwnerMiddleware } from "@/lib/auth";
import { CrewRequestError, getCrewLocation, saveVenuePin, saveCrewStop, removeCrewStop } from "@/features/festival-crew/crew-service";
import { PhotonGeocodingProvider, OverpassPlacesProvider, PlaceProviderError, safePublicUrl } from "@/features/festival-crew/places-provider";

const router: IRouter = Router();
const geo = new PhotonGeocodingProvider(), places = new OverpassPlacesProvider();
const prefix = "/event-profiles/:id/editions/:year";
router.use(requireOwnerMiddleware);
router.use(prefix, (req, res, next) => {
  if (!z.string().uuid().safeParse(req.params.id).success || !z.coerce.number().int().min(1900).max(2200).safeParse(req.params.year).success) {
    res.status(400).json({ error: "Choose a valid profile and event year." }); return;
  }
  res.set("Cache-Control", "no-store"); next();
});
function failure(req: any, res: any, error: unknown) {
  if (error instanceof CrewRequestError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof PlaceProviderError) { res.status(503).json({ error: error.message }); return; }
  req.log?.error({ error }, "Festival crew location request failed");
  res.status(503).json({ error: "Could not complete this request. Saved information is unchanged; keep your draft and try again." });
}
router.get(`${prefix}/crew-location`, async (req, res) => {
  try { res.json(await getCrewLocation(String(req.params.id), Number(req.params.year))); } catch (e) { failure(req, res, e); }
});
router.put(`${prefix}/crew-location`, async (req, res) => {
  const parsed = SaveFestivalVenuePinBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter valid coordinates and reload the current event year before saving." }); return; }
  try { res.json(await saveVenuePin(String(req.params.id), Number(req.params.year), parsed.data)); } catch (e) { failure(req, res, e); }
});
router.post(`${prefix}/crew-location/search`, async (req, res) => {
  const parsed = SearchFestivalVenueBody.safeParse(req.body);
  if (!parsed.success || parsed.data.query.trim().length < 3) { res.status(400).json({ error: "Enter a public venue address to search." }); return; }
  try {
    const current = await getCrewLocation(String(req.params.id), Number(req.params.year));
    if (!current.venue.trim()) throw new CrewRequestError(409, "Add this year's venue in event details first. The organizer address is not used.");
    res.json({ candidates: await geo.geocode(parsed.data.query) });
  } catch (e) { failure(req, res, e); }
});
router.post(`${prefix}/nearby/search`, async (req, res) => {
  const parsed = SearchFestivalNearbyStopsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose a search radius of 10, 25 or 50 miles." }); return; }
  try {
    const current = await getCrewLocation(String(req.params.id), Number(req.params.year));
    if (!current.location) throw new CrewRequestError(409, "Confirm this event year's venue pin before finding nearby places.");
    res.json(await places.search(current.location.latitude, current.location.longitude, parsed.data.radiusMiles));
  } catch (e) { failure(req, res, e); }
});
function validStop(data: any) {
  if (!data.name.trim() || (data.latitude === null) !== (data.longitude === null)) return false;
  if ([data.website, data.sourceUrl].some(value => value && !safePublicUrl(value))) return false;
  if (data.sourceKey !== null && (!/^(node|way|relation)\/[1-9]\d*$/.test(data.sourceKey) || data.sourceUrl !== `https://www.openstreetmap.org/${data.sourceKey}`)) return false;
  return true;
}
router.post(`${prefix}/crew-stops`, async (req, res) => {
  const parsed = CreateFestivalCrewStopBody.safeParse(req.body);
  if (!parsed.success || !validStop(parsed.data)) { res.status(400).json({ error: "Review the stop name, paired coordinates and http/https links." }); return; }
  try { res.status(201).json(await saveCrewStop(String(req.params.id), Number(req.params.year), null, parsed.data)); } catch (e) { failure(req, res, e); }
});
router.put(`${prefix}/crew-stops/:stopId`, async (req, res) => {
  const parsed = UpdateFestivalCrewStopBody.safeParse(req.body);
  if (!z.string().uuid().safeParse(req.params.stopId).success || !parsed.success || !validStop(parsed.data)) { res.status(400).json({ error: "Review the stop name, coordinates and links." }); return; }
  try { res.json(await saveCrewStop(String(req.params.id), Number(req.params.year), String(req.params.stopId), parsed.data)); } catch (e) { failure(req, res, e); }
});
router.delete(`${prefix}/crew-stops/:stopId`, async (req, res) => {
  const parsed = RemoveFestivalCrewStopBody.safeParse(req.body);
  if (!z.string().uuid().safeParse(req.params.stopId).success || !parsed.success) { res.status(400).json({ error: "Reload this saved stop before removing it." }); return; }
  try { await removeCrewStop(String(req.params.id), Number(req.params.year), String(req.params.stopId), parsed.data.expectedUpdatedAt); res.status(204).end(); } catch (e) { failure(req, res, e); }
});
export default router;
