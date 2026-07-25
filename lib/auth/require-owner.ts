import { auth } from "@clerk/nextjs/server";
import { getServerEnvironment } from "@/lib/env";

export function authorizeOwner(userId: string | null, ownerUserId: string) {
  if (!userId || userId !== ownerUserId) {
    throw new Error("Not authorized");
  }

  return { userId };
}

export async function requireOwner(): Promise<{ userId: string }> {
  const { userId } = await auth();
  const { OWNER_CLERK_USER_ID } = getServerEnvironment();

  return authorizeOwner(userId, OWNER_CLERK_USER_ID);
}
