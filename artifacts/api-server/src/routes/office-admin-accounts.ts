import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { hashPasswordCredential } from "@/lib/password-credential";

const router: IRouter = Router();
const repository = new DrizzleOfficeAccountRepository(db);
const accountIdSchema = z.string().uuid();
const passwordSchema = z.string().min(8, "Use at least 8 characters.").max(500);

const createSchema = z.object({
  loginName: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(160),
  password: passwordSchema,
  canReviewWebsiteInquiries: z.boolean().optional(),
}).strict();

const patchSchema = z.object({
  loginName: z.string().trim().min(1).max(120).optional(),
  displayName: z.string().trim().min(1).max(160).optional(),
  enabled: z.boolean().optional(),
  canReviewWebsiteInquiries: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "No account changes provided." });

function routeId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function conflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

router.get("/office-admin/accounts", async (_req, res) => {
  res.json({ accounts: await repository.listAdmin() });
});

router.post("/office-admin/accounts", async (req, res): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the account details." });
    return;
  }
  try {
    const credential = await hashPasswordCredential(parsed.data.password);
    const account = await repository.createAccount({
      loginName: parsed.data.loginName,
      displayName: parsed.data.displayName,
      passwordHash: credential.hash,
      passwordSalt: credential.salt,
      canReviewWebsiteInquiries: parsed.data.canReviewWebsiteInquiries ?? false,
    });
    res.status(201).json({ account });
  } catch (error) {
    if (conflict(error)) {
      res.status(409).json({ error: "That Office Coordinator username is already in use." });
      return;
    }
    req.log.error({ err: error }, "Failed to create office account");
    res.status(500).json({ error: "Could not create Office Coordinator account." });
  }
});

router.patch("/office-admin/accounts/:accountId", async (req, res): Promise<void> => {
  const accountId = routeId(req.params.accountId);
  const parsedId = accountIdSchema.safeParse(accountId);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid account ID." : parsed.error.issues[0]?.message ?? "Review the account changes." });
    return;
  }
  try {
    const account = await repository.updateAccount(accountId, parsed.data);
    if (!account) {
      res.status(404).json({ error: "Office Coordinator account not found." });
      return;
    }
    res.json({ account });
  } catch (error) {
    if (conflict(error)) {
      res.status(409).json({ error: "That Office Coordinator username is already in use." });
      return;
    }
    req.log.error({ err: error }, "Failed to update office account");
    res.status(500).json({ error: "Could not update Office Coordinator account." });
  }
});

router.put("/office-admin/accounts/:accountId/password", async (req, res): Promise<void> => {
  const accountId = routeId(req.params.accountId);
  const parsedId = accountIdSchema.safeParse(accountId);
  const parsed = z.object({ password: passwordSchema }).strict().safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid account ID." : parsed.error.issues[0]?.message ?? "Review the password." });
    return;
  }
  const credential = await hashPasswordCredential(parsed.data.password);
  const account = await repository.setPassword(accountId, credential.hash, credential.salt);
  if (!account) {
    res.status(404).json({ error: "Office Coordinator account not found." });
    return;
  }
  res.json({ account });
});

router.post("/office-admin/accounts/:accountId/sign-out-all", async (req, res): Promise<void> => {
  const accountId = routeId(req.params.accountId);
  if (!accountIdSchema.safeParse(accountId).success) {
    res.status(400).json({ error: "Invalid account ID." });
    return;
  }
  if (!(await repository.incrementSessionVersion(accountId))) {
    res.status(404).json({ error: "Office Coordinator account not found." });
    return;
  }
  res.json({ ok: true });
});

export default router;
