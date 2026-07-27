import { z } from "zod";

const serverEnvironmentSchema = z.object({
  OWNER_CLERK_USER_ID: z.string().trim().min(1),
});

const actEnvironmentSchema = z.object({
  ACT_API_BASE_URL: z.literal("https://apius.act.com/act.web.api"),
  ACT_DATABASE_NAME: z.string().trim().min(1),
  ACT_USERNAME: z.string().trim().min(1),
  ACT_PASSWORD: z.string().min(1),
});

type EnvironmentSource = Record<string, string | undefined>;

export function getServerEnvironment() {
  return serverEnvironmentSchema.parse({
    OWNER_CLERK_USER_ID: process.env.OWNER_CLERK_USER_ID,
  });
}

export function parseActEnvironment(source: EnvironmentSource):
  | { configured: false }
  | {
      configured: true;
      config: {
        baseUrl: "https://apius.act.com/act.web.api";
        databaseName: string;
        username: string;
        password: string;
      };
    } {
  const values = {
    ACT_API_BASE_URL: source.ACT_API_BASE_URL,
    ACT_DATABASE_NAME: source.ACT_DATABASE_NAME,
    ACT_USERNAME: source.ACT_USERNAME,
    ACT_PASSWORD: source.ACT_PASSWORD,
  };
  if (Object.values(values).every((value) => !value)) {
    return { configured: false };
  }
  const parsed = actEnvironmentSchema.parse(values);
  return {
    configured: true,
    config: {
      baseUrl: parsed.ACT_API_BASE_URL,
      databaseName: parsed.ACT_DATABASE_NAME,
      username: parsed.ACT_USERNAME,
      password: parsed.ACT_PASSWORD,
    },
  };
}

export function getActEnvironment() {
  return parseActEnvironment(process.env);
}
