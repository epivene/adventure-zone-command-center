import { Router, type IRouter, type Response } from "express";

import type {
  ArchivedProfileSummary,
  ProfileArchiveState,
} from "@/features/record-lifecycle/profile-lifecycle-repository";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProfileLifecycleRouteService {
  listArchived(): Promise<ArchivedProfileSummary[]>;
  archive(profileId: string, actorId: string | null): Promise<ProfileArchiveState>;
  restore(profileId: string, actorId: string | null): Promise<ProfileArchiveState>;
}

async function productionService(): Promise<ProfileLifecycleRouteService> {
  const [{ db }, { ProfileLifecycleService }] = await Promise.all([
    import("@/db/client"),
    import("@/features/record-lifecycle/profile-lifecycle-service"),
  ]);
  return new ProfileLifecycleService(db);
}

function serializeState(state: ProfileArchiveState) {
  return {
    id: state.id,
    archivedAt: state.archivedAt?.toISOString() ?? null,
  };
}

function serializeSummary(profile: ArchivedProfileSummary) {
  return {
    ...profile,
    archivedAt: profile.archivedAt.toISOString(),
  };
}

function sendLifecycleError(res: Response, error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (code === "PROFILE_NOT_FOUND") {
    res.status(404).json({ ok: false, error: "Profile not found." });
    return;
  }
  res.status(500).json({ ok: false, error: "The profile lifecycle change could not be saved." });
}

export function createProfileLifecycleRouter(input: {
  service?: ProfileLifecycleRouteService;
} = {}): IRouter {
  const router: IRouter = Router();
  const withService = async <T>(action: (service: ProfileLifecycleRouteService) => Promise<T>) =>
    action(input.service ?? await productionService());

  router.get("/profile-lifecycle/archived", async (_req, res) => {
    try {
      const profiles = await withService((service) => service.listArchived());
      res.json({ ok: true, profiles: profiles.map(serializeSummary) });
    } catch (error) {
      sendLifecycleError(res, error);
    }
  });

  for (const action of ["archive", "restore"] as const) {
    router.post(`/profile-lifecycle/:id/${action}`, async (req, res) => {
      const profileId = req.params.id;
      if (!uuidPattern.test(profileId)) {
        res.status(400).json({ ok: false, error: "Invalid profile ID." });
        return;
      }
      try {
        const profile = await withService((service) => service[action](profileId, "owner"));
        res.json({ ok: true, profile: serializeState(profile) });
      } catch (error) {
        sendLifecycleError(res, error);
      }
    });
  }

  return router;
}

export default createProfileLifecycleRouter();
