import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("uploads from one local agent and restores into a second paired agent", async () => {
  const [{ createSyncServer }, client] = await Promise.all([import("../services/sync-server/http.ts"), import("./sync-client.ts")]);
  const serverDir = await mkdtemp(join(tmpdir(), "ranoa-sync-client-server-"));
  const ownerBase = await mkdtemp(join(tmpdir(), "ranoa-sync-owner-"));
  const laptopBase = await mkdtemp(join(tmpdir(), "ranoa-sync-laptop-"));
  const ownerDir = join(ownerBase, "agent");
  const laptopDir = join(laptopBase, "agent");
  await Promise.all([mkdir(ownerDir, { recursive: true }), mkdir(laptopDir, { recursive: true })]);
  const { server } = await createSyncServer({ dataDir: serverDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    await mkdir(join(ownerDir, "sessions"), { recursive: true });
    await writeFile(join(ownerDir, "settings.json"), JSON.stringify({ language: "zh-CN" }));
    await writeFile(join(ownerDir, "sessions", "one.jsonl"), "session-data");
    const owner = await client.createVault(endpoint, ownerDir, "Owner");
    const uploaded = await client.uploadLocalChanges(endpoint, ownerDir, owner);
    assert.equal(uploaded.uploaded, 2);

    const code = await client.createPairingCode(endpoint, owner);
    const request = await client.requestPairing(endpoint, laptopDir, code.code, "Laptop");
    const laptopBefore = await client.getLocalSyncDevice(laptopDir);
    await client.approvePairing(endpoint, owner, request.requestId, laptopBefore.publicKey);
    const pairing = await client.pairingStatus(endpoint, request.requestId);
    assert.equal(pairing.status, "approved");
    const laptop = await client.completePairing(endpoint, laptopDir, pairing.response, "Laptop");
    const plan = await client.syncPlan(endpoint, laptopDir, laptop);
    assert.equal(plan.download.length, 2);
    const restored = await client.downloadRemoteChanges(endpoint, laptopDir, laptop, plan);
    assert.equal(restored.downloaded, 2);
    assert.equal(await readFile(join(laptopDir, "settings.json"), "utf8"), JSON.stringify({ language: "zh-CN" }));
    assert.equal(await readFile(join(laptopDir, "sessions", "one.jsonl"), "utf8"), "session-data");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await Promise.all([rm(serverDir, { recursive: true, force: true }), rm(ownerBase, { recursive: true, force: true }), rm(laptopBase, { recursive: true, force: true })]);
  }
});
