import { describe, expect, it, vi } from "vitest";

import {
  submitQuickCaller,
  type QuickCallerRepository,
} from "./quick-caller-service";
import type { DuplicateCandidate } from "@/features/caller-finder/caller-finder-types";

const baseInput = {
  requestKey: "11111111-1111-4111-8111-111111111111",
  name: "Avery Lee",
  organizationName: "North Star Events",
  phone: "701-555-0199",
  email: "avery@example.com",
  reason: "New inquiry",
  eventDate: "",
  eventLocation: "Fargo, ND",
};

function repositoryWith(
  candidates: DuplicateCandidate[],
  exactExists = candidates.some((candidate) => candidate.kind === "exact"),
): QuickCallerRepository {
  return {
    hasExactQuickCallerDuplicate: vi.fn(async () => exactExists),
    findQuickCallerDuplicates: vi.fn(async () => candidates),
    createQuickCaller: vi.fn(async () => ({
      kind: "created" as const,
      contactId: "99999999-9999-4999-8999-999999999999",
    })),
  };
}

describe("quick caller duplicate gate", () => {
  it("blocks exact normalized phone or email duplicates even when continuation is requested", async () => {
    const candidates: DuplicateCandidate[] = [{
      contactId: "11111111-1111-4111-8111-111111111111",
      name: "Existing Avery",
      organizationName: "North Star Events",
      city: "Fargo",
      region: "ND",
      reasons: ["Exact phone", "Exact email"],
      kind: "exact",
    }];
    const repository = repositoryWith(candidates);

    const result = await submitQuickCaller(
      { ...baseInput, continueCreating: true },
      repository,
    );

    expect(result).toEqual({
      ok: false,
      candidates,
      canContinueCreating: false,
    });
    expect(repository.createQuickCaller).not.toHaveBeenCalled();
  });

  it("requires an explicit continuation before creating past likely name and organization matches", async () => {
    const candidates: DuplicateCandidate[] = [{
      contactId: "22222222-2222-4222-8222-222222222222",
      name: "Avery Lee",
      organizationName: "North Star Events",
      city: "Bismarck",
      region: "ND",
      reasons: ["Name and organization"],
      kind: "likely",
    }];
    const repository = repositoryWith(candidates);

    expect(await submitQuickCaller(baseInput, repository))
      .toEqual({ ok: false, candidates, canContinueCreating: true });
    expect(repository.createQuickCaller).not.toHaveBeenCalled();

    await expect(submitQuickCaller(
      { ...baseInput, continueCreating: true },
      repository,
    )).resolves.toEqual({
      ok: true,
      contactId: "99999999-9999-4999-8999-999999999999",
    });
  });

  it("allows manually entered contact text in the email field", async () => {
    const repository = repositoryWith([]);
    const result = await submitQuickCaller(
      { ...baseInput, email: "Use the website contact form" },
      repository,
    );

    expect(result).toEqual({
      ok: true,
      contactId: "99999999-9999-4999-8999-999999999999",
    });
    expect(repository.createQuickCaller).toHaveBeenCalledWith(
      expect.objectContaining({ email: "use the website contact form" }),
    );
  });

  it("blocks a hidden exact duplicate behind eight likely candidates even with continuation", async () => {
    const candidates: DuplicateCandidate[] = Array.from(
      { length: 8 },
      (_, index) => ({
        contactId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: "Avery Lee",
        organizationName: "North Star Events",
        city: "Fargo",
        region: "ND",
        reasons: ["Name and organization"],
        kind: "likely",
      }),
    );
    const repository = repositoryWith(candidates, true);

    const result = await submitQuickCaller(
      { ...baseInput, continueCreating: true },
      repository,
    );

    expect(result).toEqual({
      ok: false,
      candidates,
      canContinueCreating: false,
    });
    expect(repository.createQuickCaller).not.toHaveBeenCalled();
  });
});
