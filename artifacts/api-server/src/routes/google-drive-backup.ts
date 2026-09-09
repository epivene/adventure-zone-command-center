import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";

import { GoogleDriveBackupBackfillService } from "@/features/google-drive-backup/google-drive-backup-backfill-service";
import { PostgresGoogleDriveBackupRepository } from "@/features/google-drive-backup/google-drive-backup-repository";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";

const ROOT_NAME = "Adventure Zone Command Center Backup";
const empty = z.object({}).strict();
const rootBody = z.object({ confirmation: z.literal("CREATE BACKUP FOLDER") }).strict();
const pilotBody = z.object({
  profileLimit: z.number().int().min(1).max(25),
  confirmation: z.literal("START PILOT"),
}).strict();
const backfillBody = z.object({ confirmation: z.literal("START BACKFILL") }).strict();
type SqlPool = { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> };

type Dependencies = {
  pool: SqlPool;
  repository: PostgresGoogleDriveBackupRepository;
  backfill: GoogleDriveBackupBackfillService;
  connections: PostgresGoogleConnectionRepository;
  now(): Date;
};

function defaults(): Dependencies {
  const sql = pool as unknown as SqlPool;
  return {
    pool: sql,
    repository: new PostgresGoogleDriveBackupRepository(sql),
    backfill: new GoogleDriveBackupBackfillService(sql),
    connections: new PostgresGoogleConnectionRepository({ pool: sql }),
    now: () => new Date(),
  };
}

function actor(req: Request): string {
  return String((req as Request & { userId?: string }).userId ?? "owner");
}

function safeCode(error: unknown): string {
  const value = error instanceof Error ? error.message
    : error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code) : "";
  return /^(GOOGLE_DRIVE_BACKUP_|GOOGLE_WORKSPACE_)[A-Z0-9_]+$/.test(value)
    ? value : "GOOGLE_DRIVE_BACKUP_REQUEST_FAILED";
}

function statusFor(code: string): number {
  if (/INVALID/.test(code)) return 400;
  if (/REAUTHORIZATION|REQUIRED|NOT_CONNECTED/.test(code)) return 409;
  return 500;
}

export function createGoogleDriveBackupRouter(
  dependencies: Dependencies = defaults(),
): IRouter {
  const router = Router();

  router.get("/google-drive-backup", async (_req, res) => {
    try {
      const [config, counts, run, connection] = await Promise.all([
        dependencies.repository.getConfig(),
        dependencies.pool.query(
          `SELECT status, count(*)::int AS count
             FROM google_drive_backup_jobs GROUP BY status ORDER BY status`,
        ),
        dependencies.pool.query(
          `SELECT id, mode, state, counts, created_at, updated_at
             FROM google_drive_backup_runs
            ORDER BY created_at DESC LIMIT 1`,
        ),
        dependencies.connections.getCurrent(),
      ]);
      res.json({
        connection,
        scopeReady: connection?.status === "connected",
        reconnectRequired: connection?.status === "reauthorization_required" ||
          config.state === "reauthorization_required",
        config,
        queue: Object.fromEntries(counts.rows.map((row) => [String(row.status), Number(row.count)])),
        run: run.rows[0] ?? null,
      });
    } catch (error) {
      const code = safeCode(error);
      res.status(statusFor(code)).json({ error: code });
    }
  });

  router.post("/google-drive-backup/root", async (req, res) => {
    if (!rootBody.safeParse(req.body ?? {}).success) {
      res.status(400).json({ error: "GOOGLE_DRIVE_BACKUP_ROOT_CONFIRMATION_INVALID" });
      return;
    }
    try {
      const current = await dependencies.repository.getConfig();
      if (current.rootFolderId) {
        res.json({ id: current.rootFolderId, webViewLink: current.rootWebViewLink, name: ROOT_NAME });
        return;
      }
      const connection = await dependencies.connections.createDriveBackupClient();
      if (!connection) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
      const folder = await connection.client.createFolder("root", ROOT_NAME);
      const now = dependencies.now();
      await dependencies.pool.query(
        `UPDATE google_drive_backup_config
            SET connection_id = $1, root_folder_id = $2, root_web_view_link = $3,
                state = 'preview', updated_at = $4
          WHERE id = 'default' AND root_folder_id IS NULL`,
        [connection.connectionId, folder.id, folder.webViewLink, now],
      );
      res.status(201).json(folder);
    } catch (error) {
      const code = safeCode(error);
      res.status(statusFor(code)).json({ error: code });
    }
  });

  router.post("/google-drive-backup/preview", async (req, res) => {
    if (!empty.safeParse(req.body ?? {}).success) {
      res.status(400).json({ error: "GOOGLE_DRIVE_BACKUP_PREVIEW_INVALID" }); return;
    }
    try { res.json(await dependencies.backfill.preview(dependencies.now())); }
    catch (error) { const code = safeCode(error); res.status(statusFor(code)).json({ error: code }); }
  });

  router.post("/google-drive-backup/pilot", async (req, res) => {
    const parsed = pilotBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "GOOGLE_DRIVE_BACKUP_PILOT_LIMIT_INVALID" }); return;
    }
    try {
      res.status(202).json(await dependencies.backfill.startPilot({
        profileLimit: parsed.data.profileLimit, now: dependencies.now(), createdBy: actor(req),
      }));
    } catch (error) { const code = safeCode(error); res.status(statusFor(code)).json({ error: code }); }
  });

  router.post("/google-drive-backup/backfill/start", async (req, res) => {
    if (!backfillBody.safeParse(req.body ?? {}).success) {
      res.status(400).json({ error: "GOOGLE_DRIVE_BACKUP_BACKFILL_CONFIRMATION_INVALID" }); return;
    }
    try {
      res.status(202).json(await dependencies.backfill.startBackfill({
        now: dependencies.now(), createdBy: actor(req),
      }));
    } catch (error) { const code = safeCode(error); res.status(statusFor(code)).json({ error: code }); }
  });

  router.post("/google-drive-backup/backfill/pause", async (req, res) => {
    if (!empty.safeParse(req.body ?? {}).success) { res.status(400).json({ error: "GOOGLE_DRIVE_BACKUP_REQUEST_INVALID" }); return; }
    try { res.json(await dependencies.backfill.pause(dependencies.now())); }
    catch (error) { const code = safeCode(error); res.status(statusFor(code)).json({ error: code }); }
  });

  router.post("/google-drive-backup/backfill/resume", async (req, res) => {
    if (!empty.safeParse(req.body ?? {}).success) { res.status(400).json({ error: "GOOGLE_DRIVE_BACKUP_REQUEST_INVALID" }); return; }
    try { res.json(await dependencies.backfill.resume(dependencies.now())); }
    catch (error) { const code = safeCode(error); res.status(statusFor(code)).json({ error: code }); }
  });

  router.post("/google-drive-backup/retry", async (req, res) => {
    if (!empty.safeParse(req.body ?? {}).success) { res.status(400).json({ error: "GOOGLE_DRIVE_BACKUP_REQUEST_INVALID" }); return; }
    try { res.json({ retried: await dependencies.repository.retryFailed(dependencies.now()) }); }
    catch (error) { const code = safeCode(error); res.status(statusFor(code)).json({ error: code }); }
  });

  return router;
}

export default createGoogleDriveBackupRouter();
