import { homedir } from "node:os";
import { join } from "node:path";

/** Stable per-user data root. It intentionally lives outside the repository. */
export const RANOA_HOME = join(homedir(), ".ranoa");
export const RANOA_PI_HOME = join(RANOA_HOME, "pi");
export const RANOA_AGENT_DIR = join(RANOA_PI_HOME, "agent");
export const RANOA_ATTACHMENTS_DIR = join(RANOA_HOME, "attachments");

export function configureRanoaEnvironment(): void {
  if (!process.env.PI_CODING_AGENT_DIR) {
    process.env.PI_CODING_AGENT_DIR = RANOA_AGENT_DIR;
  }
}
