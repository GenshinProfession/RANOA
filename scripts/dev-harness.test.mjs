import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  HARNESS_DEFAULT_PORT,
  resolveHarnessConfig,
} from "./dev-harness.mjs";

test("uses an isolated port and agent directory by default", () => {
  const root = resolve("C:/workspace/pi-harness");
  const userHome = resolve("C:/Users/example");
  const config = resolveHarnessConfig({}, root, userHome);

  assert.equal(config.port, HARNESS_DEFAULT_PORT);
  assert.equal(config.hostname, "127.0.0.1");
  assert.equal(config.agentDir, join(root, ".pi-harness-dev", "agent"));
  assert.equal(config.existingAgentDir, join(userHome, ".pi", "agent"));
  assert.notEqual(config.agentDir, config.existingAgentDir);
});

test("rejects the existing Pi Web port", () => {
  assert.throws(
    () => resolveHarnessConfig({ PI_HARNESS_PORT: "30141" }, "C:/workspace/pi-harness", "C:/Users/example"),
    /reserved for the existing Pi Web installation/,
  );
});

test("rejects the existing Pi agent data directory", () => {
  const userHome = resolve("C:/Users/example");
  assert.throws(
    () => resolveHarnessConfig(
      { PI_HARNESS_AGENT_DIR: join(userHome, ".pi", "agent") },
      "C:/workspace/pi-harness",
      userHome,
    ),
    /overlaps the existing Pi data/,
  );
});

test("rejects parent and child directories of the existing Pi data", () => {
  const userHome = resolve("C:/Users/example");

  assert.throws(
    () => resolveHarnessConfig(
      { PI_HARNESS_AGENT_DIR: join(userHome, ".pi") },
      "C:/workspace/pi-harness",
      userHome,
    ),
    /overlaps the existing Pi data/,
  );
  assert.throws(
    () => resolveHarnessConfig(
      { PI_HARNESS_AGENT_DIR: join(userHome, ".pi", "agent", "harness") },
      "C:/workspace/pi-harness",
      userHome,
    ),
    /overlaps the existing Pi data/,
  );
});

test("accepts explicit safe overrides", () => {
  const config = resolveHarnessConfig(
    {
      PI_HARNESS_PORT: "32141",
      PI_HARNESS_HOSTNAME: "localhost",
      PI_HARNESS_AGENT_DIR: "./tmp/agent",
    },
    "C:/workspace/pi-harness",
    "C:/Users/example",
  );

  assert.equal(config.port, 32141);
  assert.equal(config.hostname, "localhost");
  assert.equal(config.agentDir, resolve("C:/workspace/pi-harness", "tmp/agent"));
});
