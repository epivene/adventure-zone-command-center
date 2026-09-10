import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { db, pool } from "@workspace/db";
import { requireOwnerMiddleware } from "../lib/auth";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { ConventionRepository } from "../features/convention-outreach/repository";
import { ConventionError } from "../features/convention-outreach/policy";

const uuid = z.string().uuid(),
  revision = z.number().int().positive();
const text = z.string().trim().max(12000);
export function createConventionRouter(
  repo: ConventionRepository,
  authenticate: RequestHandler,
  boss = false,
): IRouter {
  const router: IRouter = Router(),
    prefix = boss ? "/boss/conventions" : "/conventions";
  router.use(prefix, authenticate);
  const route =
    (fn: (req: any, res: any) => Promise<void>) =>
    async (req: any, res: any) => {
      try {
        await fn(req, res);
      } catch (error) {
        if (error instanceof z.ZodError) {
          res
            .status(400)
            .json({ error: "Please check the fields and try again." });
          return;
        }
        if (error instanceof ConventionError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        req.log?.error({ err: error }, "Convention request failed");
        res
          .status(500)
          .json({ error: "Could not save or load the convention. Try again." });
      }
    };
  const actor = (req: any) =>
    boss
      ? `boss:${req.bossAccount.accountId}`
      : `owner:${req.userId ?? "owner"}`;
  router.get(
    prefix,
    route(async (_req, res) => {
      res.json({ editions: await repo.list() });
    }),
  );
  if (!boss)
    router.get(
      `${prefix}/profile-search`,
      route(async (req, res) => {
        res.json({
          profiles: await repo.searchProfiles(
            z.string().trim().min(2).max(200).parse(req.query.q),
          ),
        });
      }),
    );
  router.get(
    `${prefix}/profiles/:profileId`,
    route(async (req, res) => {
      res.json({
        members: await repo.profileHistory(uuid.parse(req.params.profileId)),
      });
    }),
  );
  router.get(
    `${prefix}/:id`,
    route(async (req, res) => {
      res.json(await repo.detail(uuid.parse(req.params.id), actor(req)));
    }),
  );
  router.get(
    `${prefix}/:id/members/:memberId/context`,
    route(async (req, res) => {
      res.json(
        await repo.memberContext(
          uuid.parse(req.params.id),
          uuid.parse(req.params.memberId),
        ),
      );
    }),
  );
  router.post(
    `${prefix}/:id/review`,
    route(async (req, res) => {
      const input = z.object({ revision, note: text }).parse(req.body);
      res.json(
        await repo.review(
          uuid.parse(req.params.id),
          input.revision,
          input.note,
          actor(req),
        ),
      );
    }),
  );
  if (boss) return router;
  router.patch(
    `${prefix}/:id`,
    route(async (req, res) => {
      const input = z
        .object({
          revision,
          summary: text,
          recommendation: text,
          sources: text,
          archived: z.boolean(),
        })
        .parse(req.body);
      res.json({
        edition: await repo.updateEdition(
          uuid.parse(req.params.id),
          input.revision,
          input,
          actor(req),
        ),
      });
    }),
  );
  router.post(
    prefix,
    route(async (req, res) => {
      const input = z
        .object({
          convention: z.string().trim().min(1).max(200),
          year: z.number().int().min(2000).max(2200),
          summary: text.default(""),
          recommendation: text.default(""),
          sources: text.default(""),
        })
        .parse(req.body);
      res.status(201).json({ edition: await repo.create(input, actor(req)) });
    }),
  );
  const rows = z.array(z.unknown()).min(1).max(2000);
  router.post(
    `${prefix}/:id/import-preview`,
    route(async (req, res) => {
      res.json(
        await repo.preview(
          uuid.parse(req.params.id),
          rows.parse(req.body.rows),
        ),
      );
    }),
  );
  router.post(
    `${prefix}/:id/import`,
    route(async (req, res) => {
      const input = z
        .object({ rows, revision, mutationKey: uuid })
        .parse(req.body);
      res.json(
        await repo.import(
          uuid.parse(req.params.id),
          input.rows,
          input.revision,
          input.mutationKey,
          actor(req),
        ),
      );
    }),
  );
  router.patch(
    `${prefix}/:id/members/:memberId`,
    route(async (req, res) => {
      const input = z
        .object({
          revision,
          data: z.unknown(),
          organizationId: uuid.nullable(),
          contactId: uuid.nullable(),
        })
        .parse(req.body);
      res.json({
        member: await repo.updateMember(
          uuid.parse(req.params.id),
          uuid.parse(req.params.memberId),
          input.revision,
          input.data,
          input,
          actor(req),
        ),
      });
    }),
  );
  router.post(
    `${prefix}/:id/rollover`,
    route(async (req, res) => {
      const input = z.object({ revision }).parse(req.body);
      res.json({
        edition: await repo.rollover(
          uuid.parse(req.params.id),
          input.revision,
          actor(req),
        ),
      });
    }),
  );
  return router;
}
const repository = new ConventionRepository(pool);
export const bossConventionRouter = createConventionRouter(
  repository,
  createRequireBossMiddleware(new DrizzleBossAccountRepository(db)),
  true,
);
export default createConventionRouter(repository, requireOwnerMiddleware);
