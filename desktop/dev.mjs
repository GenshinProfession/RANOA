import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const defaultUrl = "http://127.0.0.1:31141";

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`RANOA server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The development server has not opened its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the RANOA development server");
}

async function isRanoaServer(url) {
  try {
    const response = await fetch(`${url}/api/runtime/identity`);
    if (!response.ok) return false;
    const body = await response.json();
    return body.product === "RANOA";
  } catch {
    return false;
  }
}

async function findExistingServer() {
  const candidates = [process.env.RANOA_DESKTOP_URL, defaultUrl]
    .filter(Boolean);
  for (const candidate of candidates) {
    if (await isRanoaServer(candidate)) return candidate;
  }
  return null;
}

let url = await findExistingServer();
let server = null;
if (!url) {
  url = defaultUrl;
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  server = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", "31141"], {
    cwd: root,
    env: {
      ...process.env,
      RANOA_DESKTOP: "1",
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".ranoa", "pi", "agent"),
    },
    stdio: "inherit",
  });
}

let desktop;
const stop = () => {
  if (desktop && desktop.exitCode === null) desktop.kill();
  if (server && server.exitCode === null) server.kill();
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("exit", stop);

try {
  if (server) await waitForServer(url, server);
  desktop = spawn(electronPath, [path.join(root, "desktop", "main.cjs")], {
    cwd: root,
    env: { ...process.env, RANOA_DESKTOP_URL: url },
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve) => desktop.once("exit", (code) => resolve(code ?? 0)));
  stop();
  process.exitCode = exitCode;
} catch (error) {
  stop();
  throw error;
}
