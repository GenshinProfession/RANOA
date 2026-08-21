import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const [, , command, ...args] = process.argv;
if (!command) throw new Error("Usage: node scripts/ranoa-env.mjs <command> [args...]");

const env = {
  ...process.env,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || join(homedir(), ".ranoa", "pi", "agent"),
};
const child = spawn(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
