import { Router, type IRouter } from "express";
import {
  issueToken,
  requireOwnerMiddleware,
  verifyOwnerPassword,
} from "../lib/auth";

const router: IRouter = Router();

// Public: exchange the owner password for a signed bearer token.
router.post("/auth/login", (req, res) => {
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  if (!password || !verifyOwnerPassword(password)) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  const issued = issueToken();
  if (!issued) {
    res.status(500).json({ error: "Server auth is not configured" });
    return;
  }
  res.json(issued);
});

// Authenticated: validate the current token.
router.get("/auth/me", requireOwnerMiddleware, (_req, res) => {
  res.json({ ok: true, role: "owner" });
});

export default router;
