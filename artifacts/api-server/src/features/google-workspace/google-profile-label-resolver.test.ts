import { describe, expect, it, vi } from "vitest";

import type {
  GoogleGmailLabelMutationClient,
  GoogleLabelSummary,
} from "./google-api-types";
import { GoogleProfileLabelResolver } from "./google-profile-label-resolver";
import type {
  GoogleProfileLabelMapping,
  GoogleProfileLabelRepositoryPort,
} from "./google-profile-label-repository";

function harness(input?: {
  labels?: GoogleLabelSummary[];
  mapping?: GoogleProfileLabelMapping | null;
  organizationName?: string;
  otherOwnerLabelId?: string;
}) {
  let mapping = input?.mapping ?? null;
  const labels = input?.labels ?? [];
  const created: GoogleLabelSummary = {
    id: "Label_created",
    name: `Z - AdventureZone/Profiles/${input?.organizationName ?? "Elko County Fair"}`,
    type: "user",
  };
  const repository: GoogleProfileLabelRepositoryPort = {
    getOrganization: vi.fn(async () => ({
      id: "org-1",
      name: input?.organizationName ?? "Elko County Fair",
      consolidatedIntoId: null,
    })),
    findByOrganization: vi.fn(async () => mapping),
    findByLabelId: vi.fn(async ({ gmailLabelId }) =>
      gmailLabelId === input?.otherOwnerLabelId
        ? {
            connectionId: "conn-1",
            organizationId: "org-2",
            gmailLabelId,
            gmailLabelName: "owned elsewhere",
            state: "active",
            lastErrorCode: null,
          }
        : mapping?.gmailLabelId === gmailLabelId ? mapping : null,
    ),
    adopt: vi.fn(async (value) => {
      mapping = {
        ...value,
        state: "active",
        lastErrorCode: null,
      };
      return mapping;
    }),
    markState: vi.fn(async () => undefined),
    listManagedLabelIds: vi.fn(async () => mapping ? [mapping.gmailLabelId] : []),
  };
  const gmail: GoogleGmailLabelMutationClient = {
    listLabels: vi.fn(async () => labels),
    createLabel: vi.fn(async () => created),
    renameLabel: vi.fn(async ({ labelId, name }) => ({
      id: labelId,
      name,
      type: "user",
    })),
    modifyThreadLabels: vi.fn(async () => undefined),
    modifyMessageLabels: vi.fn(async () => undefined),
  };
  return {
    repository,
    gmail,
    resolver: new GoogleProfileLabelResolver(repository, gmail),
  };
}

describe("GoogleProfileLabelResolver", () => {
  it("reuses a saved Gmail label id after a CRM rename", async () => {
    const saved: GoogleProfileLabelMapping = {
      connectionId: "conn-1",
      organizationId: "org-1",
      gmailLabelId: "Label_10",
      gmailLabelName: "Z - AdventureZone/Profiles/Old Name",
      state: "active",
      lastErrorCode: null,
    };
    const h = harness({
      mapping: saved,
      organizationName: "New Name",
      labels: [{ id: "Label_10", name: saved.gmailLabelName, type: "user" }],
    });

    await expect(h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    })).resolves.toMatchObject({
      status: "resolved",
      mapping: { gmailLabelId: "Label_10" },
    });
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
  });

  it("adopts one existing canonical label instead of creating another", async () => {
    const label = {
      id: "Label_existing",
      name: "Z - AdventureZone/Profiles/Elko County Fair",
      type: "user" as const,
    };
    const h = harness({ labels: [label] });

    await expect(h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    })).resolves.toMatchObject({
      status: "resolved",
      mapping: { gmailLabelId: "Label_existing" },
    });
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
  });

  it("adopts a single normalized-compatible label", async () => {
    const h = harness({
      labels: [{
        id: "Label_existing",
        name: " Z - AdventureZone / Profiles / ELKO   County Fair ",
        type: "user",
      }],
    });

    await expect(h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    })).resolves.toMatchObject({ status: "resolved" });
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
  });

  it("stops on ambiguous normalized labels without creating one", async () => {
    const h = harness({
      labels: [
        {
          id: "Label_1",
          name: "Z - AdventureZone/Profiles/ELKO County Fair",
          type: "user",
        },
        {
          id: "Label_2",
          name: "Z - AdventureZone/Profiles/Elko  County Fair",
          type: "user",
        },
      ],
    });

    await expect(h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    })).resolves.toMatchObject({
      status: "conflict",
      labels: [{ id: "Label_1" }, { id: "Label_2" }],
    });
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
    expect(h.repository.markState).toHaveBeenCalled();
  });

  it("creates one canonical label only when no compatible label exists", async () => {
    const h = harness({ labels: [] });

    await expect(h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    })).resolves.toMatchObject({
      status: "resolved",
      mapping: { gmailLabelId: "Label_created" },
    });
    expect(h.gmail.createLabel).toHaveBeenCalledWith(
      "Z - AdventureZone/Profiles/Elko County Fair",
    );
  });

  it("does not adopt a label already owned by another profile", async () => {
    const label = {
      id: "Label_owned",
      name: "Z - AdventureZone/Profiles/Elko County Fair",
      type: "user" as const,
    };
    const h = harness({ labels: [label], otherOwnerLabelId: label.id });

    await expect(h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    })).resolves.toMatchObject({ status: "conflict" });
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
  });

  it("marks a saved missing label unavailable instead of replacing it", async () => {
    const h = harness({
      mapping: {
        connectionId: "conn-1",
        organizationId: "org-1",
        gmailLabelId: "Label_missing",
        gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
        state: "active",
        lastErrorCode: null,
      },
      labels: [],
    });

    await expect(h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    })).rejects.toThrow("GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND");
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
    expect(h.repository.markState).toHaveBeenCalledWith(expect.objectContaining({
      state: "unavailable",
    }));
  });
});
