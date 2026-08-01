import { z } from "zod";

import { applyActImport } from "@/features/import/act-matcher";
import { requireOwner } from "@/lib/auth/require-owner";

const applyInputSchema = z.object({
  runId: z.uuid(),
  approvedRowIds: z.array(z.string().min(1)).max(10_000),
});

export async function POST(request: Request) {
  await requireOwner();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Choose a valid import run and approved rows." },
      { status: 400 },
    );
  }
  const input = applyInputSchema.safeParse(body);
  if (!input.success) {
    return Response.json(
      { error: "Choose a valid import run and approved rows." },
      { status: 400 },
    );
  }

  try {
    const result = await applyActImport(
      input.data.runId,
      input.data.approvedRowIds,
    );
    return Response.json(result);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Import run was not found." ||
        error.message === "Import run has already been applied.")
    ) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json(
      {
        error:
          "No rows were applied because the import transaction could not be completed.",
      },
      { status: 500 },
    );
  }
}
