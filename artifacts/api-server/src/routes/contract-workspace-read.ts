import { Router, type IRouter } from "express";
import { z } from "zod";
import { contractStatusValues } from "@workspace/db";

type Queries = {
  listWorkspaceContracts(filters: {
    status?: typeof contractStatusValues[number];
    organizationId?: string;
    bookingId?: string;
  }): Promise<unknown>;
};

const filtersSchema = z.object({
  status: z.enum(contractStatusValues).optional(),
  organizationId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
}).strict();

export function createContractWorkspaceReadRouter(queries: Queries): IRouter {
  const router = Router();
  router.get("/contracts/workspace", async (req, res) => {
    const parsed = filtersSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid contract filters." });
      return;
    }
    try {
      res.json({ contracts: await queries.listWorkspaceContracts(parsed.data) });
    } catch {
      res.status(503).json({ error: "Contract tracking is temporarily unavailable." });
    }
  });
  return router;
}
