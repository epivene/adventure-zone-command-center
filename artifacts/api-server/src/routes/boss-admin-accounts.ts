import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { hashPasswordCredential } from "@/lib/password-credential";
const router: IRouter = Router(), repository = new DrizzleBossAccountRepository(db), id = z.string().uuid(), password = z.string().min(8).max(500);
const param = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const publicAccount = (a: any) => ({ id: a.id, loginName: a.loginName, displayName: a.displayName, role: a.role, enabled: a.enabled, sessionVersion: a.sessionVersion, studioOfficeAccountId: a.studioOfficeAccountId });
router.get("/boss-admin/accounts", async (_req, res) => res.json({ accounts: await repository.list() }));
router.post("/boss-admin/accounts", async (req, res): Promise<void> => {
  const input = z.object({ loginName: z.string().trim().min(1).max(120), displayName: z.string().trim().min(1).max(160), password, studioOfficeAccountId: z.string().uuid().nullable().optional() }).strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.issues[0]?.message }); return; }
  try { const credential = await hashPasswordCredential(input.data.password); res.status(201).json({ account: publicAccount(await repository.create({ ...input.data, passwordHash: credential.hash, passwordSalt: credential.salt })) }); }
  catch (err: any) { res.status(err?.code === "23505" ? 409 : 500).json({ error: err?.code === "23505" ? "That Boss username is already in use." : "Could not create Boss account." }); }
});
router.patch("/boss-admin/accounts/:accountId", async (req, res): Promise<void> => {
  const accountId = param(req.params.accountId), input = z.object({ loginName: z.string().trim().min(1).max(120).optional(), displayName: z.string().trim().min(1).max(160).optional(), enabled: z.boolean().optional(), studioOfficeAccountId: z.string().uuid().nullable().optional() }).strict().refine(v => Object.keys(v).length > 0).safeParse(req.body);
  if (!id.safeParse(accountId).success || !input.success) { res.status(400).json({ error: "Review the account changes." }); return; }
  try {
    const account = await repository.update(accountId, input.data);
    if (!account) { res.status(404).json({ error: "Boss account not found." }); return; }
    res.json({ account: publicAccount(account) });
  } catch (err: any) {
    res.status(err?.code === "23505" ? 409 : 500).json({ error: err?.code === "23505" ? "That Boss username is already in use." : "Could not update Boss account." });
  }
});
router.put("/boss-admin/accounts/:accountId/password", async (req, res): Promise<void> => {
  const accountId = param(req.params.accountId), input = z.object({ password }).strict().safeParse(req.body);
  if (!id.safeParse(accountId).success || !input.success) { res.status(400).json({ error: "Review the password." }); return; }
  const credential = await hashPasswordCredential(input.data.password), account = await repository.setPassword(accountId, credential.hash, credential.salt); if (!account) { res.status(404).json({ error: "Boss account not found." }); return; } res.json({ account: publicAccount(account) });
});
router.post("/boss-admin/accounts/:accountId/sign-out-all", async (req, res) => { const accountId = param(req.params.accountId); if (!id.safeParse(accountId).success) { res.status(400).json({ error: "Invalid account ID." }); return; } if (!await repository.signOutAll(accountId)) { res.status(404).json({ error: "Boss account not found." }); return; } res.json({ ok: true }); });
export default router;