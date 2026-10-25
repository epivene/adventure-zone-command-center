import type { RequestHandler } from "express";
export const internalAiEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.INTERNAL_AI_ENABLED === "true";
export const legacyActEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.LEGACY_ACT_MIGRATION_ENABLED === "true";
export function executionPolicy(
  environment = () => process.env,
): RequestHandler {
  return (req, res, next) => {
    const env = environment(),
      path = req.path;
    if (
      !internalAiEnabled(env) &&
      /^\/(assistant(?:\/|$)|ai-suggestions(?:\/|$))/.test(path)
    ) {
      res
        .status(410)
        .json({
          error: "Internal AI is disabled. Use Today and Draft with COM.",
          code: "INTERNAL_AI_DISABLED",
        });
      return;
    }
    if (
      !legacyActEnabled(env) &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      /^\/(migration\/act(?:-replacement)?(?:\/|$)|act-recovery(?:\/|$))/.test(
        path,
      )
    ) {
      res
        .status(410)
        .json({
          error:
            "Act! migration is frozen. Imported CRM records remain available.",
          code: "LEGACY_ACT_FROZEN",
        });
      return;
    }
    next();
  };
}
