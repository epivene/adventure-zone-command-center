import { Router, type IRouter } from "express";

import {
  ownerAccountRepository,
  requireOwnerMiddleware,
} from "@/features/owner-auth/owner-runtime";
import { issueOwnerToken } from "@/features/owner-auth/owner-token";
import {
  hashPasswordCredential,
  verifyPasswordCredential,
} from "@/lib/password-credential";
import { verifyOwnerPassword } from "../lib/auth";

const router: IRouter = Router();

function publicOwner(owner: { id: string; displayName: string; role: "owner" }) {
  return { id: owner.id, displayName: owner.displayName, role: owner.role };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!password || password.length > 500) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  try {
    let owner = await ownerAccountRepository.findPrimary();
    if (!owner) {
      if (!process.env.OWNER_PASSWORD) {
        res.status(503).json({ error: "Owner sign-in is not configured" });
        return;
      }
      if (!verifyOwnerPassword(password)) {
        res.status(401).json({ error: "Incorrect password" });
        return;
      }
      const credential = await hashPasswordCredential(password);
      owner = await ownerAccountRepository.createPrimary({
        loginName: (process.env.OWNER_LOGIN_NAME ?? "desiree").trim() || "desiree",
        displayName: (process.env.OWNER_DISPLAY_NAME ?? "Desiree").trim() || "Desiree",
        passwordHash: credential.hash,
        passwordSalt: credential.salt,
      });
    }

    if (
      !owner.enabled ||
      !(await verifyPasswordCredential(password, owner.passwordHash, owner.passwordSalt))
    ) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }

    const issued = issueOwnerToken({
      ownerId: owner.id,
      sessionVersion: owner.sessionVersion,
    });
    if (!issued) {
      res.status(500).json({ error: "Server auth is not configured" });
      return;
    }
    res.json({ ...issued, owner: publicOwner(owner) });
  } catch (error) {
    req.log?.error?.({ err: error }, "Failed to sign in owner account");
    res.status(500).json({ error: "Could not sign in. Try again." });
  }
});

router.get("/auth/me", requireOwnerMiddleware, (req, res) => {
  const owner = req.ownerAccount!;
  res.json({
    ok: true,
    role: "owner",
    owner: { id: owner.accountId, displayName: owner.displayName, role: owner.role },
  });
});

router.post("/auth/sign-out-all", requireOwnerMiddleware, async (req, res): Promise<void> => {
  try {
    const ownerId = req.ownerAccount!.accountId;
    const revoked = await ownerAccountRepository.incrementSessionVersion(ownerId);
    if (!revoked) {
      res.status(404).json({ error: "Owner account not found" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    req.log?.error?.({ err: error }, "Failed to revoke owner sessions");
    res.status(500).json({ error: "Could not sign out all owner sessions." });
  }
});

export default router;
