import { z } from "zod";

const serverEnvironmentSchema = z.object({
  OWNER_CLERK_USER_ID: z.string().trim().min(1),
});

export function getServerEnvironment() {
  return serverEnvironmentSchema.parse({
    OWNER_CLERK_USER_ID: process.env.OWNER_CLERK_USER_ID,
  });
}
