import { describe, expect, it } from "vitest";
import { crewManagerNotes, crewWorkHistory } from "@/db/schema";

describe("crew idempotency schema", () => {
  it("defines client mutation columns used by crew history and notes inserts", () => {
    expect("clientMutationId" in crewWorkHistory).toBe(true);
    expect("clientMutationId" in crewManagerNotes).toBe(true);
  });
});
