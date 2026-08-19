import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");

export const HARNESS_DEFAULT_PORT = 31141;
export const PI_WEB_DEFAULT_PORT = 30141;

function comparablePath(value) {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathsOverlap(left, right) {
  const normalizedLeft = comparablePath(left);
  const normalizedRight = comparablePath(right);
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}${sep}`)
    || normalizedRight.startsWith(`${normalizedLeft}${sep}`);
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error("PI_HARNESS_PORT must be an integer between 1 and 65535.");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PI_HARNESS_PORT must be an integer between 1 and 65535.");
  }
  if (port === PI_WEB_DEFAULT_PORT) {
    throw new Error(
      `PI_HARNESS_PORT cannot use ${PI_WEB_DEFAULT_PORT}; that port is reserved for the existing Pi Web installation.`,
    );
  }
  return port;
}

export function resolveHarnessConfig(
  env = process.env,
  root = projectRoot,
  userHome = homedir(),
) {
  const port = parsePort(env.PI_HARNESS_PORT?.trim() || String(HARNESS_DEFAULT_PORT));
  const hostname = env.PI_HARNESS_HOSTNAME?.trim() || "127.0.0.1";
  const agentDir = resolve(root, env.PI_HARNESS_AGENT_DIR?.trim() || ".pi-harness-dev/agent");
  const existingAgentDir = resolve(userHome, ".pi", "agent");

  if (pathsOverlap(agentDir, existingAgentDir)) {
    throw new Error(
      `Refusing a data directory that overlaps the existing Pi data: ${existingAgentDir}. `
      + "Choose a separate PI_HARNESS_AGENT_DIR and migrate data explicitly later.",
    );
  }

  return { root: resolve(root), port, hostname, agentDir, existingAgentDir };
}

export function startHarness(config = resolveHarnessConfig()) {
  mkdirSync(config.agentDir, { recursive: true });
  const nextBin = require.resolve("next/dist/bin/next", { paths: [config.root] });

  console.log(`[pi-harness] URL: http://${config.hostname}:${config.port}`);
  console.log(`[pi-harness] Isolated agent data: ${config.agentDir}`);
  console.log(`[pi-harness] Existing Pi data remains untouched: ${config.existingAgentDir}`);

  const child = spawn(
    process.execPath,
    [nextBin, "dev", "-H", config.hostname, "-p", String(config.port)],
    {
      cwd: config.root,
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(config.port),
        PI_CODING_AGENT_DIR: config.agentDir,
        PI_WEB_HOSTNAME: config.hostname,
        PI_WEB_NO_OPEN: "1",
      },
    },
  );

  child.on("exit", (code, signal) => {
    if (signal) console.error(`[pi-harness] Dev server exited from signal ${signal}.`);
    process.exitCode = code ?? 1;
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }

  return child;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  try {
    startHarness();
  } catch (error) {
    console.error(`[pi-harness] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
