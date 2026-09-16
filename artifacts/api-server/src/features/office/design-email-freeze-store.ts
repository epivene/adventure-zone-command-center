import { and, desc, eq } from "drizzle-orm";

import {
  designProjectVersions,
  designProjects,
} from "@workspace/db/design-studio-schema";
import { organizationContacts } from "@workspace/db/schema";
import type { DesignEmailFreezeStore } from "./design-email-renderer";

type TransactionalDesignDatabase = {
  transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
};

export function createDrizzleDesignEmailFreezeStore(
  database: TransactionalDesignDatabase,
): DesignEmailFreezeStore {
  return {
    transaction: (callback) =>
      database.transaction(async (transaction) =>
        callback({
          async loadOwnedEmailProject({ projectId, accountId }) {
            const [row] = await transaction
              .select({
                id: designProjects.id,
                content: designProjects.content,
                linkedOrganizationId: designProjects.linkedOrganizationId,
                linkedContactId: designProjects.linkedContactId,
              })
              .from(designProjects)
              .innerJoin(
                organizationContacts,
                and(
                  eq(
                    organizationContacts.organizationId,
                    designProjects.linkedOrganizationId,
                  ),
                  eq(
                    organizationContacts.contactId,
                    designProjects.linkedContactId,
                  ),
                  eq(organizationContacts.active, true),
                ),
              )
              .where(
                and(
                  eq(designProjects.id, projectId),
                  eq(designProjects.officeAccountId, accountId),
                  eq(designProjects.type, "email"),
                ),
              )
              .limit(1)
              .for("update");
            return row ?? null;
          },
          async insertImmutableVersion({ project, accountId }) {
            const [latest] = await transaction
              .select({ versionNumber: designProjectVersions.versionNumber })
              .from(designProjectVersions)
              .where(eq(designProjectVersions.projectId, project.id))
              .orderBy(desc(designProjectVersions.createdAt))
              .limit(1);
            const current = Number(latest?.versionNumber?.replace(/^v/, ""));
            const [version] = await transaction
              .insert(designProjectVersions)
              .values({
                projectId: project.id,
                versionNumber: `v${Number.isFinite(current) ? current + 1 : 1}`,
                content: project.content,
                status: "ready",
                isImmutable: true,
                createdByAccountId: accountId,
                frozenAt: new Date(),
              })
              .returning({ id: designProjectVersions.id });
            if (!version) throw new Error("DESIGN_EMAIL_VERSION_CREATE_FAILED");
            return version;
          },
        }),
      ),
  };
}
