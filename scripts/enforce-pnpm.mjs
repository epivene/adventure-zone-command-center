import { rmSync } from "node:fs";
import path from "node:path";

rmSync(path.join(process.cwd(), "package-lock.json"), { force: true });
rmSync(path.join(process.cwd(), "yarn.lock"), { force: true });

if (!(process.env.npm_config_user_agent ?? "").startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exitCode = 1;
}
