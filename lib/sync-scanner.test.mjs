import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scanAgentData } from "./sync-scanner.ts";
import { createDefaultSyncState, readLocalManifest, readSyncState, writeLocalManifest, writeSyncState } from "./sync-state.ts";

test("scans portable Pi data and excludes secrets, caches, and platform resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "ranoa-sync-"));
  try {
    await mkdir(join(root, "sessions"), { recursive: true });
    await mkdir(join(root, "skills", "example"), { recursive: true });
    await mkdir(join(root, "npm"), { recursive: true });
    await writeFile(join(root, "settings.json"), "{\"language\":\"zh-CN\"}");
    await writeFile(join(root, "models.json"), "{\"providers\":{}}\n");
    await writeFile(join(root, "auth.json"), "{\"secret\":\"must-not-be-read-by-sync\"}\n");
    await writeFile(join(root, "sessions", "one.jsonl"), "{\"type\":\"session\"}\n");
    await writeFile(join(root, "skills", "example", "SKILL.md"), "# Example\n");
    await writeFile(join(root, "npm", "cache.bin"), "cache");

    const { manifest, summary } = await scanAgentData(root);
    assert.equal(summary.files, 4);
    assert.equal(manifest.entries.some((entry) => entry.path === "auth.json"), false);
    assert.equal(manifest.entries.some((entry) => entry.path.startsWith("npm/")), false);
    assert.deepEqual(manifest.entries.map((entry) => entry.path), [
      "models.json",
      "sessions/one.jsonl",
      "settings.json",
      "skills/example/SKILL.md",
    ]);
    assert.ok(summary.skipped.some((item) => item.path === "auth.json" && item.reason === "credentials"));
    assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists a local manifest and safe sync state atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "ranoa-sync-state-"));
  const agentDir = join(root, "agent");
  try {
    await mkdir(agentDir, { recursive: true });
    const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), entries: [], totalBytes: 0, manifestSha256: "abc" };
    await writeLocalManifest(agentDir, manifest);
    await writeSyncState(agentDir, createDefaultSyncState());
    assert.deepEqual(await readLocalManifest(agentDir), manifest);
    assert.equal((await readSyncState(agentDir)).connection.status, "disconnected");
    assert.equal(await readFile(join(root, ".ranoa-sync", "state.json"), "utf8"), `${JSON.stringify(createDefaultSyncState(), null, 2)}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
