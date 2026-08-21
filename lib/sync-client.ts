import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { encryptChunk, encryptJson, objectIdForPath, operationId, unwrapVaultKey, wrapVaultKey } from "./sync-crypto.ts";
import { getOrCreateLocalSyncDevice, localVaultKey, type LocalSyncDevice, writeLocalSyncDevice, createLocalVaultState, freshVaultKey } from "./sync-device.ts";
import { readSyncJournal } from "./sync-journal.ts";
import type { LocalSyncEntry, LocalSyncManifest } from "./sync-types.ts";
import type { SyncAuthResponse, SyncAuditRecord, SyncCommitResponse, SyncConflictRecord, SyncObjectDescriptor, SyncPlanResponse, SyncRestorePlan, SyncSnapshotRecord } from "./sync-protocol.ts";
import { getSyncDir, readLocalManifest, readSyncState, writeSyncState } from "./sync-state.ts";
import { scanAgentData } from "./sync-scanner.ts";

interface EncryptedObjectManifest {
  schemaVersion: 1;
  objectId: string;
  path: string;
  category: LocalSyncEntry["category"];
  size: number;
  sha256: string;
  modifiedAt: string;
  chunkIds: string[];
}

interface LocalDescriptor {
  objectId: string;
  currentRevision: number;
  deleted: boolean;
  chunkIds: string[];
}

interface SyncClientResponse<T> { value: T; response: Response; }

export interface SyncRemoteAuth {
  username?: string;
  password?: string;
}

function setRemoteAuth(headers: Headers, auth?: SyncRemoteAuth): void {
  if (!auth?.username || !auth.password) return;
  headers.set("x-ranoa-sync-auth", `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`);
}

function endpointUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function requestJson<T>(endpoint: string, path: string, init: RequestInit = {}, deviceToken?: string, auth?: SyncRemoteAuth): Promise<SyncClientResponse<T>> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");
  if (deviceToken) headers.set("authorization", `Bearer ${deviceToken}`);
  setRemoteAuth(headers, auth);
  const response = await fetch(endpointUrl(endpoint, path), { ...init, headers });
  const value = await response.json().catch(() => ({})) as T & { message?: string; error?: string };
  if (!response.ok) {
    const error = new Error(value.message ?? value.error ?? `Sync request failed with ${response.status}`) as Error & { status?: number; details?: unknown; code?: string };
    error.status = response.status;
    error.details = (value as { details?: unknown }).details;
    error.code = (value as { error?: string }).error;
    throw error;
  }
  return { value, response };
}

async function requestBinary(endpoint: string, path: string, deviceToken: string, auth?: SyncRemoteAuth): Promise<Buffer> {
  const headers = new Headers({ authorization: `Bearer ${deviceToken}` });
  setRemoteAuth(headers, auth);
  const response = await fetch(endpointUrl(endpoint, path), { headers });
  if (!response.ok) throw new Error(`Unable to download sync chunk (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

function assertSafeRelativePath(agentDir: string, path: string): string {
  if (!path || isAbsolute(path)) throw new Error("Remote sync path must be relative");
  const destination = resolve(agentDir, path);
  const remainder = relative(resolve(agentDir), destination);
  if (remainder.startsWith("..") || isAbsolute(remainder)) throw new Error("Remote sync path escapes the agent directory");
  return destination;
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function readOrScan(agentDir: string): Promise<LocalSyncManifest> {
  const current = await readLocalManifest(agentDir);
  if (current) return current;
  const scanned = await scanAgentData(agentDir);
  await writeJsonAtomically(join(getSyncDir(agentDir), "local-manifest.json"), scanned.manifest);
  return scanned.manifest;
}

async function uploadChunk(endpoint: string, token: string, chunk: ReturnType<typeof encryptChunk>, auth?: SyncRemoteAuth): Promise<void> {
  const headHeaders = new Headers({ authorization: `Bearer ${token}` });
  setRemoteAuth(headHeaders, auth);
  const head = await fetch(endpointUrl(endpoint, `/v1/chunks/${chunk.chunkId}`), { method: "HEAD", headers: headHeaders });
  if (head.ok) return;
  const putHeaders = new Headers({ authorization: `Bearer ${token}`, "content-type": "application/octet-stream" });
  setRemoteAuth(putHeaders, auth);
  const response = await fetch(endpointUrl(endpoint, `/v1/chunks/${chunk.chunkId}`), { method: "PUT", headers: putHeaders, body: Buffer.from(JSON.stringify(chunk)) });
  if (!response.ok) throw new Error(`Unable to upload sync chunk (${response.status})`);
}

async function commitLocalEntry(endpoint: string, device: LocalSyncDevice, vaultKey: Buffer, agentDir: string, entry: LocalSyncEntry, baseRevision: number, auth?: SyncRemoteAuth): Promise<{ descriptor: LocalSyncObjectRecordLike; commit: SyncCommitResponse }> {
  const objectId = objectIdForPath(vaultKey, entry.path);
  const content = await readFile(join(agentDir, entry.path));
  const chunks = [] as ReturnType<typeof encryptChunk>[];
  const chunkSize = 4 * 1024 * 1024;
  for (let offset = 0; offset < content.length || offset === 0; offset += chunkSize) {
    const plaintext = content.subarray(offset, Math.min(content.length, offset + chunkSize));
    const chunk = encryptChunk(plaintext, vaultKey);
    chunks.push(chunk);
    await uploadChunk(endpoint, device.deviceToken!, chunk, auth);
    if (offset + chunkSize >= content.length) break;
  }
  const encryptedManifest = encryptJson({ schemaVersion: 1, objectId, path: entry.path, category: entry.category, size: entry.size, sha256: entry.sha256, modifiedAt: entry.modifiedAt, chunkIds: chunks.map((chunk) => chunk.chunkId) } satisfies EncryptedObjectManifest, vaultKey, `ranoa-object:${objectId}:${baseRevision + 1}`);
  const { value: commit } = await requestJson<SyncCommitResponse>(endpoint, `/v1/objects/${objectId}/commit`, { method: "POST", body: JSON.stringify({ operationId: operationId(), objectId, baseRevision, schemaVersion: 1, deleted: false, encryptedManifest, chunkIds: chunks.map((chunk) => chunk.chunkId) }) }, device.deviceToken!, auth);
  return { descriptor: { objectId, path: entry.path, revision: commit.revision, deleted: false, sha256: entry.sha256, chunkIds: chunks.map((chunk) => chunk.chunkId) }, commit };
}

interface LocalSyncObjectRecordLike { objectId: string; path: string; revision: number; deleted: boolean; sha256: string | null; chunkIds: string[] }

export async function createVault(endpoint: string, agentDir: string, deviceName: string, auth?: SyncRemoteAuth): Promise<LocalSyncDevice> {
  const syncDir = getSyncDir(agentDir);
  const identity = await getOrCreateLocalSyncDevice(syncDir, deviceName);
  const vaultKey = freshVaultKey();
  const response = await requestJson<SyncAuthResponse>(endpoint, "/v1/vaults", { method: "POST", body: JSON.stringify({ deviceId: identity.deviceId, deviceName, publicKey: identity.publicKey, vaultKeyEnvelope: wrapVaultKey(vaultKey, identity.publicKey) }) }, undefined, auth);
  const device = createLocalVaultState({ ...identity, name: deviceName }, response.value.vaultId, response.value.deviceToken, vaultKey, response.value.serverEpoch);
  await writeLocalSyncDevice(syncDir, device);
  const journal = await readSyncJournal(agentDir);
  await writeJsonAtomically(join(syncDir, "journal.json"), { ...journal, serverEpoch: response.value.serverEpoch });
  await writeSyncState(agentDir, { ...(await readSyncState(agentDir)), connection: { status: "connected", endpoint: endpoint.replace(/\/+$/, ""), vaultId: device.vaultId, deviceId: device.deviceId } });
  return device;
}

export async function createPairingCode(endpoint: string, device: LocalSyncDevice, auth?: SyncRemoteAuth): Promise<{ code: string; expiresAt: string }> {
  if (!device.deviceToken) throw new Error("This device is not paired");
  return (await requestJson<{ code: string; expiresAt: string }>(endpoint, "/v1/pairing/codes", { method: "POST" }, device.deviceToken, auth)).value;
}

export async function requestPairing(endpoint: string, agentDir: string, code: string, deviceName: string, auth?: SyncRemoteAuth): Promise<{ requestId: string; expiresAt: string }> {
  const syncDir = getSyncDir(agentDir);
  const existing = await getOrCreateLocalSyncDevice(syncDir, deviceName);
  return (await requestJson<{ requestId: string; expiresAt: string }>(endpoint, "/v1/pairing/requests", { method: "POST", body: JSON.stringify({ code, name: deviceName, publicKey: existing.publicKey }) }, undefined, auth)).value;
}

export async function approvePairing(endpoint: string, owner: LocalSyncDevice, requestId: string, newDevicePublicKey: string, auth?: SyncRemoteAuth): Promise<SyncAuthResponse> {
  return (await requestJson<SyncAuthResponse>(endpoint, `/v1/pairing/requests/${encodeURIComponent(requestId)}/approve`, { method: "POST", body: JSON.stringify({ vaultKeyEnvelope: wrapVaultKey(localVaultKey(owner), newDevicePublicKey) }) }, owner.deviceToken!, auth)).value;
}

export async function completePairing(endpoint: string, agentDir: string, response: SyncAuthResponse, deviceName: string, auth?: SyncRemoteAuth): Promise<LocalSyncDevice> {
  void auth;
  const syncDir = getSyncDir(agentDir);
  const existing = await getOrCreateLocalSyncDevice(syncDir, deviceName);
  const vaultKey = unwrapVaultKey(response.vaultKeyEnvelope, existing.privateKey);
  const device = createLocalVaultState({ ...existing, name: deviceName }, response.vaultId, response.deviceToken, vaultKey, response.serverEpoch);
  await writeLocalSyncDevice(syncDir, device);
  const journal = await readSyncJournal(agentDir);
  await writeJsonAtomically(join(syncDir, "journal.json"), { ...journal, serverEpoch: response.serverEpoch });
  await writeSyncState(agentDir, { ...(await readSyncState(agentDir)), connection: { status: "connected", endpoint: endpoint.replace(/\/+$/, ""), vaultId: device.vaultId, deviceId: device.deviceId } });
  return device;
}

export async function pairingStatus(endpoint: string, requestId: string, auth?: SyncRemoteAuth): Promise<{ status: "pending" | "approved" | "rejected"; response?: SyncAuthResponse }> {
  return (await requestJson<{ status: "pending" | "approved" | "rejected"; response?: SyncAuthResponse }>(endpoint, `/v1/pairing/requests/${encodeURIComponent(requestId)}`, {}, undefined, auth)).value;
}

export async function syncPlan(endpoint: string, agentDir: string, device: LocalSyncDevice, auth?: SyncRemoteAuth): Promise<SyncPlanResponse> {
  const manifest = await readOrScan(agentDir);
  const journal = await readSyncJournal(agentDir);
  const vaultKey = localVaultKey(device);
  const objects = manifest.entries.map((entry) => {
    const objectId = objectIdForPath(vaultKey, entry.path);
    const current = journal.objects[objectId];
    return { objectId, currentRevision: current?.revision ?? 0, deleted: false, changed: !current || current.deleted || current.sha256 !== entry.sha256, chunkIds: current?.chunkIds ?? [] };
  });
  const present = new Set(objects.map((object) => object.objectId));
  for (const previous of Object.values(journal.objects)) {
    if (present.has(previous.objectId)) continue;
    objects.push({ objectId: previous.objectId, currentRevision: previous.revision, deleted: true, changed: !previous.deleted, chunkIds: [] });
  }
  const plan = (await requestJson<SyncPlanResponse>(endpoint, "/v1/sync/plan", { method: "POST", body: JSON.stringify({ schemaVersion: 1, cursor: journal.cursor, objects }) }, device.deviceToken!, auth)).value;
  if (journal.serverEpoch && journal.serverEpoch !== plan.serverEpoch) {
    const error = new Error("The sync server epoch changed. Review recovery before syncing again.") as Error & { code?: string };
    error.code = "server_epoch_changed";
    throw error;
  }
  return plan;
}

export async function uploadLocalChanges(endpoint: string, agentDir: string, device: LocalSyncDevice, auth?: SyncRemoteAuth): Promise<{ uploaded: number; conflicts: number; snapshotId: string }> {
  const manifest = await readOrScan(agentDir);
  const journal = await readSyncJournal(agentDir);
  const vaultKey = localVaultKey(device);
  const snapshot = await requestJson<{ snapshotId: string }>(endpoint, "/v1/snapshots", { method: "POST", body: JSON.stringify({ label: "before local upload" }) }, device.deviceToken!, auth);
  let uploaded = 0;
  let conflicts = 0;
  const present = new Set<string>();
  for (const entry of manifest.entries) {
    const objectId = objectIdForPath(vaultKey, entry.path);
    present.add(objectId);
    const baseRevision = journal.objects[objectId]?.revision ?? 0;
    const known = journal.objects[objectId];
    if (known && !known.deleted && known.sha256 === entry.sha256) continue;
    try {
      const result = await commitLocalEntry(endpoint, device, vaultKey, agentDir, entry, baseRevision, auth);
      journal.objects[objectId] = { ...result.descriptor };
      uploaded += 1;
    } catch (error) {
      if ((error as { status?: number }).status === 409) { conflicts += 1; continue; }
      throw error;
    }
  }
  for (const [objectId, previous] of Object.entries(journal.objects)) {
    if (present.has(objectId) || previous.deleted) continue;
    const { value: commit } = await requestJson<SyncCommitResponse>(endpoint, `/v1/objects/${objectId}/commit`, { method: "POST", body: JSON.stringify({ operationId: operationId(), objectId, baseRevision: previous.revision, schemaVersion: 1, deleted: true, encryptedManifest: null, chunkIds: [] }) }, device.deviceToken!, auth);
    journal.objects[objectId] = { ...previous, revision: commit.revision, deleted: true, sha256: null, chunkIds: [] };
    uploaded += 1;
  }
  await writeJsonAtomically(join(getSyncDir(agentDir), "journal.json"), journal);
  return { uploaded, conflicts, snapshotId: snapshot.value.snapshotId };
}

async function backupFile(agentDir: string, path: string, snapshotDir: string): Promise<void> {
  const source = assertSafeRelativePath(agentDir, path);
  const destination = assertSafeRelativePath(snapshotDir, path);
  await mkdir(dirname(destination), { recursive: true });
  try { await writeFile(destination, await readFile(source), { flag: "wx", mode: 0o600 }); } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT" && code !== "EEXIST") throw error;
  }
}

async function decryptRemoteManifest(descriptor: SyncObjectDescriptor, vaultKey: Buffer, revision: number): Promise<EncryptedObjectManifest> {
  if (!descriptor.encryptedManifest) throw new Error("Remote object has no encrypted manifest");
  const { decryptJson } = await import("./sync-crypto.ts");
  return decryptJson<EncryptedObjectManifest>(descriptor.encryptedManifest, vaultKey, `ranoa-object:${descriptor.objectId}:${revision}`);
}

export async function downloadRemoteChanges(endpoint: string, agentDir: string, device: LocalSyncDevice, plan?: SyncPlanResponse, auth?: SyncRemoteAuth): Promise<{ downloaded: number; deleted: number; snapshotId: string }> {
  const currentPlan = plan ?? await syncPlan(endpoint, agentDir, device, auth);
  const journal = await readSyncJournal(agentDir);
  const vaultKey = localVaultKey(device);
  const snapshot = await requestJson<{ snapshotId: string }>(endpoint, "/v1/snapshots", { method: "POST", body: JSON.stringify({ label: "before remote restore" }) }, device.deviceToken!, auth);
  const backupDir = join(getSyncDir(agentDir), "snapshots", snapshot.value.snapshotId);
  let downloaded = 0;
  let deleted = 0;
  for (const remote of currentPlan.download) {
    const manifest = remote.deleted ? null : await decryptRemoteManifest(remote, vaultKey, remote.currentRevision);
    const path = manifest?.path ?? journal.objects[remote.objectId]?.path;
    if (!path) continue;
    const target = assertSafeRelativePath(agentDir, path);
    await backupFile(agentDir, path, backupDir);
    if (remote.deleted) {
      await rm(target, { force: true });
      journal.objects[remote.objectId] = { objectId: remote.objectId, path, revision: remote.currentRevision, deleted: true, sha256: null, chunkIds: [] };
      deleted += 1;
      continue;
    }
    if (!manifest) continue;
    const content: Buffer[] = [];
    for (const chunkId of remote.chunkIds) {
      const raw = await requestBinary(endpoint, `/v1/chunks/${chunkId}`, device.deviceToken!, auth);
      const { decryptChunk } = await import("./sync-crypto.ts");
      content.push(decryptChunk({ ...JSON.parse(raw.toString("utf8")), chunkId } as never, vaultKey));
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.concat(content), { mode: 0o600 });
    journal.objects[remote.objectId] = { objectId: remote.objectId, path, revision: remote.currentRevision, deleted: false, sha256: manifest.sha256, chunkIds: remote.chunkIds };
    downloaded += 1;
  }
  journal.cursor = currentPlan.cursor;
  journal.serverEpoch = currentPlan.serverEpoch;
  await writeJsonAtomically(join(getSyncDir(agentDir), "journal.json"), journal);
  return { downloaded, deleted, snapshotId: snapshot.value.snapshotId };
}

export async function getLocalSyncDevice(agentDir = getAgentDir()): Promise<LocalSyncDevice | null> {
  return getOrCreateLocalSyncDevice(getSyncDir(agentDir));
}

export async function buildLocalSyncDescriptor(agentDir: string, device: LocalSyncDevice): Promise<LocalDescriptor[]> {
  const manifest = await readOrScan(agentDir);
  const journal = await readSyncJournal(agentDir);
  const vaultKey = localVaultKey(device);
  return manifest.entries.map((entry) => {
    const objectId = objectIdForPath(vaultKey, entry.path);
    return { objectId, currentRevision: journal.objects[objectId]?.revision ?? 0, deleted: false, chunkIds: journal.objects[objectId]?.chunkIds ?? [] };
  });
}

export async function listSyncDevices(endpoint: string, device: LocalSyncDevice, auth?: SyncRemoteAuth): Promise<{ devices: Array<{ deviceId: string; name: string; role: string; publicKey: string; createdAt: string; lastSeenAt: string | null; status: string }> }> {
  return (await requestJson<{ devices: Array<{ deviceId: string; name: string; role: string; publicKey: string; createdAt: string; lastSeenAt: string | null; status: string }> }>(endpoint, "/v1/devices", {}, device.deviceToken!, auth)).value;
}

export async function updateSyncDevice(endpoint: string, device: LocalSyncDevice, deviceId: string, input: { action: "revoke" | "update"; name?: string; role?: "full" | "read_only" }, auth?: SyncRemoteAuth): Promise<void> {
  await requestJson(endpoint, `/v1/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: JSON.stringify(input) }, device.deviceToken!, auth);
}

export async function listSyncConflicts(endpoint: string, device: LocalSyncDevice, auth?: SyncRemoteAuth): Promise<{ conflicts: SyncConflictRecord[] }> {
  return (await requestJson<{ conflicts: SyncConflictRecord[] }>(endpoint, "/v1/conflicts", {}, device.deviceToken!, auth)).value;
}

export async function resolveSyncConflict(endpoint: string, device: LocalSyncDevice, conflictId: string, keepRevision: "local" | "remote", auth?: SyncRemoteAuth): Promise<void> {
  await requestJson(endpoint, `/v1/conflicts/${encodeURIComponent(conflictId)}`, { method: "POST", body: JSON.stringify({ keepRevision }) }, device.deviceToken!, auth);
}

export async function listSyncSnapshots(endpoint: string, device: LocalSyncDevice, auth?: SyncRemoteAuth): Promise<{ snapshots: SyncSnapshotRecord[] }> {
  return (await requestJson<{ snapshots: SyncSnapshotRecord[] }>(endpoint, "/v1/snapshots", {}, device.deviceToken!, auth)).value;
}

export async function previewSyncRestore(endpoint: string, device: LocalSyncDevice, snapshotId: string, auth?: SyncRemoteAuth): Promise<SyncRestorePlan> {
  return (await requestJson<SyncRestorePlan>(endpoint, `/v1/snapshots/${encodeURIComponent(snapshotId)}/restore-plan`, { method: "POST", body: JSON.stringify({}) }, device.deviceToken!, auth)).value;
}

export async function restoreSyncSnapshot(endpoint: string, device: LocalSyncDevice, snapshotId: string, auth?: SyncRemoteAuth): Promise<{ restored: number; snapshotId: string }> {
  return (await requestJson<{ restored: number; snapshotId: string }>(endpoint, `/v1/snapshots/${encodeURIComponent(snapshotId)}/restore`, { method: "POST", body: JSON.stringify({ confirm: true }) }, device.deviceToken!, auth)).value;
}

export async function listSyncAudit(endpoint: string, device: LocalSyncDevice, auth?: SyncRemoteAuth): Promise<{ events: SyncAuditRecord[] }> {
  return (await requestJson<{ events: SyncAuditRecord[] }>(endpoint, "/v1/audit", {}, device.deviceToken!, auth)).value;
}

export { requestJson };
