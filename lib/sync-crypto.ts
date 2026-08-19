import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  type KeyObject,
} from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const CHUNK_BYTES = 4 * 1024 * 1024;

export interface DeviceKeyPair {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

export interface VaultKeyEnvelope {
  version: 1;
  ephemeralPublicKey: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface EncryptedPayload {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface EncryptedChunk extends EncryptedPayload {
  chunkId: string;
  plaintextSha256: string;
  plaintextBytes: number;
}

export function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function fromBase64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(key: Uint8Array, value: Uint8Array | string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function keyFromDer(value: string, type: "public" | "private"): KeyObject {
  return type === "public"
    ? createPublicKey({ key: fromBase64url(value), format: "der", type: "spki" })
    : createPrivateKey({ key: fromBase64url(value), format: "der", type: "pkcs8" });
}

function deriveSessionKey(sharedSecret: Uint8Array, salt: Uint8Array): Buffer {
  return Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from("ranoa-sync-v1"), KEY_BYTES));
}

function encryptWithKey(plaintext: Uint8Array, key: Uint8Array, aad: string): EncryptedPayload {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    iv: base64url(iv),
    tag: base64url(cipher.getAuthTag()),
    ciphertext: base64url(ciphertext),
  };
}

function decryptWithKey(payload: EncryptedPayload, key: Uint8Array, aad: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, fromBase64url(payload.iv));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(fromBase64url(payload.tag));
  return Buffer.concat([decipher.update(fromBase64url(payload.ciphertext)), decipher.final()]);
}

export function generateVaultKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function generateDeviceKeyPair(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const privateKeyBytes = privateKey.export({ format: "der", type: "pkcs8" });
  return {
    deviceId: `dev_${sha256(publicKeyBytes).slice(0, 24)}`,
    publicKey: base64url(publicKeyBytes),
    privateKey: base64url(privateKeyBytes),
  };
}

export function wrapVaultKey(vaultKey: Uint8Array, devicePublicKey: string, aad = "ranoa-vault-key"): VaultKeyEnvelope {
  const { publicKey: ephemeralPublicKey, privateKey: ephemeralPrivateKey } = generateKeyPairSync("x25519");
  const sharedSecret = diffieHellman({ privateKey: ephemeralPrivateKey, publicKey: keyFromDer(devicePublicKey, "public") });
  const ephemeralPublicKeyBytes = ephemeralPublicKey.export({ format: "der", type: "spki" });
  const wrappingKey = deriveSessionKey(sharedSecret, ephemeralPublicKeyBytes);
  const payload = encryptWithKey(vaultKey, wrappingKey, aad);
  return { ...payload, ephemeralPublicKey: base64url(ephemeralPublicKeyBytes) };
}

export function unwrapVaultKey(envelope: VaultKeyEnvelope, devicePrivateKey: string, aad = "ranoa-vault-key"): Buffer {
  const privateKey = keyFromDer(devicePrivateKey, "private");
  const ephemeralPublicKeyBytes = fromBase64url(envelope.ephemeralPublicKey);
  const sharedSecret = diffieHellman({ privateKey, publicKey: createPublicKey({ key: ephemeralPublicKeyBytes, format: "der", type: "spki" }) });
  const wrappingKey = deriveSessionKey(sharedSecret, ephemeralPublicKeyBytes);
  return decryptWithKey(envelope, wrappingKey, aad);
}

export function encryptJson(value: unknown, vaultKey: Uint8Array, aad: string): EncryptedPayload {
  return encryptWithKey(Buffer.from(JSON.stringify(value), "utf8"), vaultKey, aad);
}

export function decryptJson<T>(payload: EncryptedPayload, vaultKey: Uint8Array, aad: string): T {
  return JSON.parse(decryptWithKey(payload, vaultKey, aad).toString("utf8")) as T;
}

export function encryptChunk(plaintext: Uint8Array, vaultKey: Uint8Array): EncryptedChunk {
  const plaintextSha256 = sha256(plaintext);
  const chunkId = `chk_${hmacSha256(vaultKey, plaintextSha256)}`;
  return {
    ...encryptWithKey(plaintext, vaultKey, `ranoa-chunk:${chunkId}`),
    chunkId,
    plaintextSha256,
    plaintextBytes: plaintext.byteLength,
  };
}

export function decryptChunk(payload: EncryptedChunk, vaultKey: Uint8Array): Buffer {
  const plaintext = decryptWithKey(payload, vaultKey, `ranoa-chunk:${payload.chunkId}`);
  if (plaintext.byteLength !== payload.plaintextBytes || sha256(plaintext) !== payload.plaintextSha256) {
    throw new Error("Encrypted chunk integrity check failed");
  }
  return plaintext;
}

export function objectIdForPath(vaultKey: Uint8Array, path: string): string {
  return `obj_${hmacSha256(vaultKey, `path:${path}`)}`;
}

export function operationId(): string {
  return `op_${randomUUID()}`;
}

export function chunkBuffer(value: Uint8Array, chunkBytes = CHUNK_BYTES): Buffer[] {
  const source = Buffer.from(value);
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < source.length; offset += chunkBytes) chunks.push(source.subarray(offset, Math.min(source.length, offset + chunkBytes)));
  return chunks.length ? chunks : [Buffer.alloc(0)];
}

export { CHUNK_BYTES };
