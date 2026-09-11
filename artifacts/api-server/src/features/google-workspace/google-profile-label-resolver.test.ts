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
  labelsAfterCreateConflict?: GoogleLabelSummary[];
  missingParents?: boolean;
}) {
  let mapping = input?.mapping ?? null;
  const labels: GoogleLabelSummary[] = [
    ...(input?.missingParents
      ? []
      : [
          { id: "Label_root", name: "Z - AdventureZone", type: "user" as const },
          {
            id: "Label_profiles",
            name: "Z - AdventureZone/Profiles",
            type: "user" as const,
          },
        ]),
    ...(input?.labels ?? []),
  ];
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
  let listCalls = 0;
  const gmail: GoogleGmailLabelMutationClient = {
    getThreadLabelIds: vi.fn(async () => []),
    listLabels: vi.fn(async () => {
      listCalls += 1;
      return listCalls > 1 && input?.labelsAfterCreateConflict
        ? input.labelsAfterCreateConflict
        : labels;
    }),
    createLabel: vi.fn(async (name) => {
      const profileName =
        `Z - AdventureZone/Profiles/${input?.organizationName ?? "Elko County Fair"}`;
      if (input?.labelsAfterCreateConflict && name === profileName) {
        throw Object.assign(
          new Error("GOOGLE_WORKSPACE_GMAIL_LABEL_CONFLICT"),
          { code: "GOOGLE_WORKSPACE_GMAIL_LABEL_CONFLICT" },
        );
      }
      const created: GoogleLabelSummary = {
        id:
          name === "Z - AdventureZone"
            ? "Label_root"
            : name === "Z - AdventureZone/Profiles"
              ? "Label_profiles"
              : "Label_created",
        name,
        type: "user",
      };
      labels.push(created);
      return created;
    }),
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
  const currentRoot = { id: "new-root", name: "Profiles", type: "user" as const };
  const currentLabel = { id: "renamed", name: "Profiles/Elko County Fair", type: "user" as const };

  it("adopts the renamed hierarchy without recreating the old root", async () => {
    const h = harness({ missingParents: true, labels: [currentRoot, currentLabel] });
    await expect(h.resolver.resolve({ connectionId: "conn-1", organizationId: "org-1" }))
      .resolves.toMatchObject({ status: "resolved", mapping: { gmailLabelId: "renamed" } });
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
  });

  it("persists a Gmail rename using the same saved label ID", async () => {
    const h = harness({ missingParents: true, labels: [currentRoot, currentLabel], mapping: {
      connectionId: "conn-1", organizationId: "org-1", gmailLabelId: "renamed",
      gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair", state: "unavailable",
      lastErrorCode: "GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND",
    } });
    await h.resolver.resolve({ connectionId: "conn-1", organizationId: "org-1" });
    expect(await h.repository.findByOrganization({ connectionId: "conn-1", organizationId: "org-1" }))
      .toMatchObject({ gmailLabelId: "renamed", gmailLabelName: "Profiles/Elko County Fair", state: "active", lastErrorCode: null });
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
  });

  it("creates new labels under the current root even when the old root remains", async () => {
    const h = harness({ labels: [currentRoot] });
    await h.resolver.resolve({ connectionId: "conn-1", organizationId: "org-1" });
    expect(h.gmail.createLabel).toHaveBeenCalledExactlyOnceWith("Profiles/Elko County Fair");
  });

  it("treats matching leaves across current and legacy roots as a conflict", async () => {
    const h = harness({ labels: [currentRoot, currentLabel, {
      id: "legacy", name: "Z - AdventureZone/Profiles/Elko County Fair", type: "user",
    }] });
    await expect(h.resolver.resolve({ connectionId: "conn-1", organizationId: "org-1" }))
      .resolves.toMatchObject({ status: "conflict" });
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
    expect(h.repository.adopt).not.toHaveBeenCalled();
  });

  it("does not adopt a renamed label already owned by another profile", async () => {
    const h = harness({ missingParents: true, labels: [currentRoot, currentLabel], otherOwnerLabelId: "renamed" });
    await expect(h.resolver.resolve({ connectionId: "conn-1", organizationId: "org-1" }))
      .resolves.toMatchObject({ status: "conflict" });
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
  });

  it("keeps the current hierarchy during a profile rename", async () => {
    const h = harness({ missingParents: true, labels: [currentRoot, currentLabel], organizationName: "New Fair", mapping: {
      connectionId: "conn-1", organizationId: "org-1", gmailLabelId: "renamed",
      gmailLabelName: currentLabel.name, state: "active", lastErrorCode: null,
    } });
    await expect(h.resolver.reconcileDisplayName({ connectionId: "conn-1", organizationId: "org-1" }))
      .resolves.toMatchObject({ status: "resolved", mapping: { gmailLabelId: "renamed", gmailLabelName: "Profiles/New Fair" } });
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
  });
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

  it("stops when an exact label and a normalized duplicate coexist", async () => {
    const h = harness({
      labels: [
        {
          id: "Label_exact",
          name: "Z - AdventureZone/Profiles/Elko County Fair",
          type: "user",
        },
        {
          id: "Label_duplicate",
          name: "Z - AdventureZone/Profiles/ELKO  County Fair",
          type: "user",
        },
      ],
    });

    await expect(h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    })).resolves.toMatchObject({
      status: "conflict",
      labels: [{ id: "Label_exact" }, { id: "Label_duplicate" }],
    });
    expect(h.repository.adopt).not.toHaveBeenCalled();
    expect(h.gmail.createLabel).not.toHaveBeenCalled();
  });

  it("adopts the winning label after a concurrent Gmail create conflict", async () => {
    const winner = {
      id: "Label_winner",
      name: "Z - AdventureZone/Profiles/Elko County Fair",
      type: "user" as const,
    };
    const h = harness({
      labels: [],
      labelsAfterCreateConflict: [winner],
    });

    await expect(h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    })).resolves.toMatchObject({
      status: "resolved",
      mapping: { gmailLabelId: "Label_winner" },
    });
    expect(h.gmail.createLabel).toHaveBeenCalledOnce();
    expect(h.gmail.listLabels).toHaveBeenCalledTimes(2);
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

  it("replaces a saved Gmail label mapping when the label no longer exists", async () => {
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
    })).resolves.toMatchObject({
      status: "resolved",
      mapping: { gmailLabelId: "Label_created" },
    });
    expect(h.gmail.createLabel).toHaveBeenCalledOnce();
    expect(h.repository.adopt).toHaveBeenCalledWith(expect.objectContaining({
      gmailLabelId: "Label_created",
    }));
  });
  it("creates the Gmail parent labels before a new profile label", async () => {
    const h = harness({ labels: [], missingParents: true });

    await h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    });

    expect(h.gmail.createLabel).toHaveBeenNthCalledWith(1, "Z - AdventureZone");
    expect(h.gmail.createLabel).toHaveBeenNthCalledWith(
      2,
      "Z - AdventureZone/Profiles",
    );
    expect(h.gmail.createLabel).toHaveBeenNthCalledWith(
      3,
      "Z - AdventureZone/Profiles/Elko County Fair",
    );
  });

  it("creates only missing parents when the flat profile label already exists", async () => {
    const existing = {
      id: "Label_existing",
      name: "Z - AdventureZone/Profiles/Elko County Fair",
      type: "user" as const,
    };
    const h = harness({ labels: [existing], missingParents: true });

    await expect(h.resolver.resolve({
      connectionId: "conn-1",
      organizationId: "org-1",
    })).resolves.toMatchObject({
      status: "resolved",
      mapping: { gmailLabelId: "Label_existing" },
    });
    expect(h.gmail.createLabel).toHaveBeenCalledTimes(2);
    expect(h.gmail.createLabel).toHaveBeenNthCalledWith(1, "Z - AdventureZone");
    expect(h.gmail.createLabel).toHaveBeenNthCalledWith(
      2,
      "Z - AdventureZone/Profiles",
    );
    expect(h.gmail.createLabel).not.toHaveBeenCalledWith(existing.name);
  });

});
