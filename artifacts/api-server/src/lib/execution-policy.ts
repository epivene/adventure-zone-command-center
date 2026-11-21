import type { RequestHandler } from "express";
// Retired systems cannot be re-enabled by stale deployment environment flags.
export const internalAiEnabled = (_env: NodeJS.ProcessEnv = process.env) => false;
export const legacyActEnabled = (_env: NodeJS.ProcessEnv = process.env) => false;
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
