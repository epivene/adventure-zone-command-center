import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@workspace/db/schema";

type OrganizationFamilyReviewsTable = typeof schema.organizations;
type TableConfig = {
  columns: Array<{ name: string; notNull: boolean }>;
  foreignKeys: Array<{
    onDelete?: string;
    reference: () => {
      columns: Array<{ name: string }>;
      foreignTable: unknown;
    };
  }>;
  indexes: Array<{
    config: {
      name: string;
      columns: Array<{ name: string }>;
    };
  }>;
  uniqueConstraints: Array<{
    columns: Array<{ name: string }>;
  }>;
  checks: Array<{
    name: string;
    value: Parameters<PgDialect["sqlToQuery"]>[0];
  }>;
};

function tableConfig(table: unknown): TableConfig {
  return getTableConfig(table as typeof schema.organizations) as unknown as TableConfig;
}

describe("organization hierarchy schema", () => {
  it("stores each location's parent with a restricted self-reference and index", () => {
    const config = tableConfig(schema.organizations);
    const parentOrganizationId = config.columns.find(
      (column) => column.name === "parent_organization_id",
    );

    expect(parentOrganizationId).toBeDefined();
    expect(parentOrganizationId?.notNull).toBe(false);

    const parentForeignKey = config.foreignKeys.find((foreignKey) => {
      const reference = foreignKey.reference();
      return (
        reference.columns[0]?.name === "parent_organization_id" &&
        reference.foreignTable === schema.organizations
      );
    });
    expect(parentForeignKey?.onDelete).toBe("restrict");

    expect(
      config.indexes.some(
        (index) =>
          index.config.name === "organizations_parent_organization_idx" &&
          index.config.columns.some(
            (column) => column.name === "parent_organization_id",
          ),
      ),
    ).toBe(true);
  });

  it("stores review candidates under one group key with only reviewable statuses", () => {
    const organizationFamilyReviews = (
      schema as typeof schema & {
        organizationFamilyReviews?: OrganizationFamilyReviewsTable;
      }
    ).organizationFamilyReviews;

    expect(organizationFamilyReviews).toBeDefined();
    if (!organizationFamilyReviews) return;

    const config = tableConfig(organizationFamilyReviews);
    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "group_key",
        "candidate_ids",
        "status",
        "evidence",
        "created_at",
        "updated_at",
      ]),
    );
    expect(
      config.uniqueConstraints.some((constraint) =>
        constraint.columns.some((column) => column.name === "group_key"),
      ),
    ).toBe(true);

    const statusCheck = config.checks.find(
      (check) => check.name === "organization_family_reviews_status_valid",
    );
    expect(statusCheck).toBeDefined();

    const acceptedStatuses = new PgDialect()
      .sqlToQuery(statusCheck!.value)
      .sql.match(/'[^']+'/g);
    expect(acceptedStatuses).toEqual(["'proposed'", "'not_related'"]);
  });
});
