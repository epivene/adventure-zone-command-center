import { Router, type IRouter } from "express";
import { db } from "@workspace/db";

import { DrizzleFollowUpRepository } from "@/features/follow-ups/follow-up-repository";
import { FollowUpService } from "@/features/follow-ups/follow-up-service";
import type { EditFollowUpInput } from "@/features/follow-ups/follow-up-types";

type FollowUpMutationService = Pick<FollowUpService, "edit" | "delete">;

function followUpService(): FollowUpService {
  return new FollowUpService(new DrizzleFollowUpRepository(db));
}

function followUpId(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? "" : value;
}

function editInput(id: string, body: Record<string, unknown>): EditFollowUpInput {
  return {
    followUpId: id,
    kind: body.kind,
    dueAt: new Date(typeof body.dueAt === "string" ? body.dueAt : Number.NaN),
    completed: body.completed,
    outcome: body.outcome,
  } as unknown as EditFollowUpInput;
}

export function createFollowUpsRouter(
  service: FollowUpMutationService = followUpService(),
): IRouter {
  const router: IRouter = Router();

  router.patch("/:id", async (req, res): Promise<void> => {
    try {
      const result = await service.edit(
        editInput(followUpId(req.params.id), req.body ?? {}),
      );
      if (!result.ok) {
        if (result.error.code === "FOLLOW_UP_NOT_FOUND") {
          res.status(404).json({ ok: false, error: "Follow-up not found." });
          return;
        }
        res.status(400).json({ ok: false, error: result.error.message });
        return;
      }
      res.json({ ok: true, followUp: result.value });
    } catch (error) {
      req.log.error({ error }, "Failed to update follow-up");
      res.status(500).json({ ok: false, error: "Could not update follow-up." });
    }
  });

  router.delete("/:id", async (req, res): Promise<void> => {
    try {
      const result = await service.delete(followUpId(req.params.id));
      if (!result.ok) {
        if (result.error.code === "FOLLOW_UP_NOT_FOUND") {
          res.status(404).json({ ok: false, error: "Follow-up not found." });
          return;
        }
        res.status(400).json({ ok: false, error: result.error.message });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      req.log.error({ error }, "Failed to delete follow-up");
      res.status(500).json({ ok: false, error: "Could not delete follow-up." });
    }
  });

  return router;
}

export default createFollowUpsRouter;
