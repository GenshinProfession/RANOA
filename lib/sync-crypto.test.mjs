import assert from "node:assert/strict";
import test from "node:test";

test("wraps and unwraps a vault key with device X25519 keys", async () => {
  const crypto = await import("./sync-crypto.ts");
  const owner = crypto.generateDeviceKeyPair();
  const vaultKey = crypto.generateVaultKey();
  const envelope = crypto.wrapVaultKey(vaultKey, owner.publicKey);
  assert.deepEqual(crypto.unwrapVaultKey(envelope, owner.privateKey), vaultKey);
});

test("encrypts JSON and rejects tampered ciphertext", async () => {
  const crypto = await import("./sync-crypto.ts");
  const key = crypto.generateVaultKey();
  const payload = crypto.encryptJson({ hello: "ranoa", n: 3 }, key, "test-object");
  assert.deepEqual(crypto.decryptJson(payload, key, "test-object"), { hello: "ranoa", n: 3 });
  const tampered = { ...payload, ciphertext: `${payload.ciphertext.slice(0, -1)}A` };
  assert.throws(() => crypto.decryptJson(tampered, key, "test-object"));
});

test("encrypts chunks with deterministic opaque ids and verifies integrity", async () => {
  const crypto = await import("./sync-crypto.ts");
  const key = crypto.generateVaultKey();
  const data = Buffer.from("a small encrypted chunk");
  const first = crypto.encryptChunk(data, key);
  const second = crypto.encryptChunk(data, key);
  assert.equal(first.chunkId, second.chunkId);
  assert.deepEqual(crypto.decryptChunk(first, key), data);
  assert.throws(() => crypto.decryptChunk({ ...first, plaintextSha256: "bad" }, key));
});
