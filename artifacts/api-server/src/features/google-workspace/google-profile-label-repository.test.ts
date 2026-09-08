import { describe, expect, it } from "vitest";

import { PostgresGoogleProfileLabelRepository } from "./google-profile-label-repository";

describe("PostgresGoogleProfileLabelRepository", () => {
  it("adopts by stable IDs and refreshes the name only for the same label ID", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("SELECT connection_id::text") &&
            text.includes("organization_id = $2")) {
          return {
            rows: [{
              connection_id: "conn-1",
              organization_id: "org-1",
              gmail_label_id: "Label_10",
              gmail_label_name: "Z - AdventureZone/Profiles/Elko County Fair",
              state: "active",
              last_error_code: null,
            }],
          };
        }
        return { rows: [] };
      },
    };
    const repository = new PostgresGoogleProfileLabelRepository(pool);

    await expect(repository.adopt({
      connectionId: "conn-1",
      organizationId: "org-1",
      gmailLabelId: "Label_10",
      gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
    })).resolves.toMatchObject({ gmailLabelId: "Label_10" });

    const insert = queries.find((query) =>
      query.text.includes("INSERT INTO google_workspace_profile_labels"),
    );
    expect(insert?.text).toContain(
      "WHERE google_workspace_profile_labels.gmail_label_id =",
    );
  });

  it("lists only active managed label ids", async () => {
    const pool = {
      async query(text: string) {
        expect(text).toContain("state = 'active'");
        return {
          rows: [
            { gmail_label_id: "Label_2" },
            { gmail_label_id: "Label_1" },
          ],
        };
      },
    };
    const repository = new PostgresGoogleProfileLabelRepository(pool);

    await expect(repository.listManagedLabelIds("conn-1")).resolves.toEqual([
      "Label_2",
      "Label_1",
    ]);
  });
});
