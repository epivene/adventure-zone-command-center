import { and, eq, gt, lt } from "drizzle-orm";

import {
  db,
  designCanvaConnections,
  designCanvaOauthStates,
  designProjectCanvaLinks,
  type DesignCanvaConnectionStatus,
  type DesignCanvaLinkStatus,
  type EncryptedCanvaSecretRecord,
} from "@workspace/db";

export type UpsertCanvaConnectionInput = {
  officeAccountId: string;
  canvaUserId?: string | null;
  encryptedAccessToken: EncryptedCanvaSecretRecord;
  encryptedRefreshToken?: EncryptedCanvaSecretRecord | null;
  tokenExpiresAt?: Date | null;
  scopes: string[];
  status?: DesignCanvaConnectionStatus;
};

export type UpsertProjectCanvaLinkInput = {
  projectId: string;
  designId: string;
  importedVersionId: string;
  status?: DesignCanvaLinkStatus;
  lastImportAt?: Date | null;
  lastError?: string | null;
};

export async function getCanvaConnection(officeAccountId: string) {
  const [connection] = await db
    .select()
    .from(designCanvaConnections)
    .where(eq(designCanvaConnections.officeAccountId, officeAccountId))
    .limit(1);
  return connection ?? null;
}

export async function upsertCanvaConnection(input: UpsertCanvaConnectionInput) {
  const now = new Date();
  const [connection] = await db
    .insert(designCanvaConnections)
    .values({
      officeAccountId: input.officeAccountId,
      canvaUserId: input.canvaUserId ?? null,
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken ?? null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      scopes: input.scopes,
      status: input.status ?? "connected",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: designCanvaConnections.officeAccountId,
      set: {
        canvaUserId: input.canvaUserId ?? null,
        encryptedAccessToken: input.encryptedAccessToken,
        encryptedRefreshToken: input.encryptedRefreshToken ?? null,
        tokenExpiresAt: input.tokenExpiresAt ?? null,
        scopes: input.scopes,
        status: input.status ?? "connected",
        updatedAt: now,
      },
    })
    .returning();
  if (!connection) throw new Error("Canva connection was not saved.");
  return connection;
}

export async function setCanvaConnectionStatus(
  officeAccountId: string,
  status: DesignCanvaConnectionStatus,
) {
  const [connection] = await db
    .update(designCanvaConnections)
    .set({ status, updatedAt: new Date() })
    .where(eq(designCanvaConnections.officeAccountId, officeAccountId))
    .returning();
  return connection ?? null;
}

export async function deleteCanvaConnection(officeAccountId: string) {
  await db
    .delete(designCanvaConnections)
    .where(eq(designCanvaConnections.officeAccountId, officeAccountId));
}

export async function getProjectCanvaLink(projectId: string) {
  const [link] = await db
    .select()
    .from(designProjectCanvaLinks)
    .where(eq(designProjectCanvaLinks.projectId, projectId))
    .limit(1);
  return link ?? null;
}

export async function upsertProjectCanvaLink(input: UpsertProjectCanvaLinkInput) {
  const now = new Date();
  const [link] = await db
    .insert(designProjectCanvaLinks)
    .values({
      projectId: input.projectId,
      designId: input.designId,
      importedVersionId: input.importedVersionId,
      status: input.status ?? "ready",
      lastImportAt: input.lastImportAt ?? now,
      lastError: input.lastError ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: designProjectCanvaLinks.projectId,
      set: {
        designId: input.designId,
        importedVersionId: input.importedVersionId,
        status: input.status ?? "ready",
        lastImportAt: input.lastImportAt ?? now,
        lastError: input.lastError ?? null,
        updatedAt: now,
      },
    })
    .returning();
  if (!link) throw new Error("Canva project link was not saved.");
  return link;
}

export async function markProjectCanvaLinkFailed(projectId: string, error: string) {
  const [link] = await db
    .update(designProjectCanvaLinks)
    .set({ status: "failed", lastError: error.slice(0, 4000), updatedAt: new Date() })
    .where(eq(designProjectCanvaLinks.projectId, projectId))
    .returning();
  return link ?? null;
}

export async function saveCanvaOauthState(input: {
  officeAccountId: string;
  state: string;
  encryptedCodeVerifier: EncryptedCanvaSecretRecord;
  returnPath: string;
  expiresAt: Date;
}) {
  await db.delete(designCanvaOauthStates).where(
    and(
      eq(designCanvaOauthStates.officeAccountId, input.officeAccountId),
      lt(designCanvaOauthStates.expiresAt, new Date()),
    ),
  );

  const [state] = await db
    .insert(designCanvaOauthStates)
    .values(input)
    .returning();
  if (!state) throw new Error("Canva OAuth state was not saved.");
  return state;
}

export async function consumeCanvaOauthState(stateValue: string) {
  const now = new Date();
  const [state] = await db
    .delete(designCanvaOauthStates)
    .where(
      and(
        eq(designCanvaOauthStates.state, stateValue),
        gt(designCanvaOauthStates.expiresAt, now),
      ),
    )
    .returning();
  return state ?? null;
}
