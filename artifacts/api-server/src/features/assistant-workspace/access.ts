import type { Actor } from "./contracts";
export function assertActionAccess(input: {
  actor: Actor;
  ownerId: string;
  requiredConnectionId: string | null;
}) {
  if (input.actor.id !== input.ownerId || input.actor.role !== "owner")
    throw new Error("ASSISTANT_ACCESS_DENIED");
  if (
    input.requiredConnectionId !== null &&
    input.requiredConnectionId !== input.actor.connectionId
  )
    throw new Error("ASSISTANT_CONNECTION_CHANGED");
}
