import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function start() {
  const { createSyncServer } = await import("./http.ts");
  const dataDir = await mkdtemp(join(tmpdir(), "ranoa-sync-server-"));
  const { server } = await createSyncServer({ dataDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;
  return { endpoint, server, dataDir };
}

async function json(endpoint, path, init = {}) {
  const response = await fetch(`${endpoint}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test("runs pairing, encrypted chunk commit, idempotency, conflict and lease flow", async () => {
  const { server, endpoint, dataDir } = await start();
  try {
    const crypto = await import("../../lib/sync-crypto.ts");
    const owner = crypto.generateDeviceKeyPair();
    const vaultKey = crypto.generateVaultKey();
    const created = await json(endpoint, "/v1/vaults", { method: "POST", body: JSON.stringify({ deviceId: owner.deviceId, deviceName: "Owner", publicKey: owner.publicKey, vaultKeyEnvelope: crypto.wrapVaultKey(vaultKey, owner.publicKey) }) });
    assert.equal(created.response.status, 201);
    const ownerToken = created.body.deviceToken;
    const code = await json(endpoint, "/v1/pairing/codes", { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: "{}" });
    assert.equal(code.response.status, 201);
    const other = crypto.generateDeviceKeyPair();
    const requested = await json(endpoint, "/v1/pairing/requests", { method: "POST", body: JSON.stringify({ code: code.body.code, name: "Laptop", publicKey: other.publicKey }) });
    assert.equal(requested.response.status, 201);
    const approved = await json(endpoint, `/v1/pairing/requests/${requested.body.requestId}/approve`, { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ vaultKeyEnvelope: crypto.wrapVaultKey(vaultKey, other.publicKey) }) });
    assert.equal(approved.response.status, 200);
    assert.deepEqual(crypto.unwrapVaultKey(approved.body.vaultKeyEnvelope, other.privateKey), vaultKey);

    const chunk = crypto.encryptChunk(Buffer.from("secret session text"), vaultKey);
    const chunkResponse = await fetch(`${endpoint}/v1/chunks/${chunk.chunkId}`, { method: "PUT", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/octet-stream" }, body: JSON.stringify(chunk) });
    assert.equal(chunkResponse.status, 201);
    const objectId = crypto.objectIdForPath(vaultKey, "sessions/example.jsonl");
    const manifest = crypto.encryptJson({ path: "sessions/example.jsonl", chunkIds: [chunk.chunkId] }, vaultKey, `ranoa-object:${objectId}:1`);
    const commitInput = { operationId: "op-fixed", objectId, baseRevision: 0, schemaVersion: 1, deleted: false, encryptedManifest: manifest, chunkIds: [chunk.chunkId] };
    const committed = await json(endpoint, `/v1/objects/${objectId}/commit`, { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: JSON.stringify(commitInput) });
    assert.equal(committed.response.status, 200);
    assert.equal(committed.body.revision, 1);
    const retried = await json(endpoint, `/v1/objects/${objectId}/commit`, { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: JSON.stringify(commitInput) });
    assert.equal(retried.response.status, 200);
    assert.equal(retried.body.revision, 1);
    const conflict = await json(endpoint, `/v1/objects/${objectId}/commit`, { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ ...commitInput, operationId: "op-conflict", baseRevision: 0 }) });
    assert.equal(conflict.response.status, 409);
    const conflicts = await json(endpoint, "/v1/conflicts", { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(conflicts.response.status, 200);
    assert.equal(conflicts.body.conflicts.length, 1);
    const resolved = await json(endpoint, `/v1/conflicts/${conflicts.body.conflicts[0].conflictId}`, { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ keepRevision: "remote" }) });
    assert.equal(resolved.response.status, 200);
    const beforeRestore = await json(endpoint, "/v1/snapshots", { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ label: "test restore point" }) });
    assert.equal(beforeRestore.response.status, 201);
    const snapshots = await json(endpoint, "/v1/snapshots", { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(snapshots.response.status, 200);
    assert.equal(snapshots.body.snapshots[0].objectCount, 1);
    const audit = await json(endpoint, "/v1/audit", { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(audit.response.status, 200);
    assert.ok(audit.body.events.some((event) => event.action === "object_committed"));
    const epochBefore = await json(endpoint, "/v1/epoch", { headers: { authorization: `Bearer ${ownerToken}` } });
    const epochRotate = await json(endpoint, "/v1/epoch/rotate", { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: "{}" });
    assert.equal(epochRotate.response.status, 200);
    assert.notEqual(epochRotate.body.serverEpoch, epochBefore.body.serverEpoch);
    const lease = await json(endpoint, "/v1/sessions/session-1/lease", { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ runId: "run-1" }) });
    assert.equal(lease.response.status, 200);
    const otherLease = await json(endpoint, "/v1/sessions/session-1/lease", { method: "POST", headers: { authorization: `Bearer ${approved.body.deviceToken}` }, body: JSON.stringify({ runId: "run-2" }) });
    assert.equal(otherLease.response.status, 409);
    const changes = await json(endpoint, "/v1/changes?after=0", { headers: { authorization: `Bearer ${approved.body.deviceToken}` } });
    assert.equal(changes.response.status, 200);
    assert.equal(changes.body.changes.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
