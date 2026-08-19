import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { VaultKeyEnvelope, EncryptedPayload } from "../../lib/sync-crypto.ts";
import type {
  SyncAuthResponse,
  SyncAuditRecord,
  SyncChangePage,
  SyncCommitRequest,
  SyncCommitResponse,
  SyncDeviceRecord,
  SyncDeviceRole,
  SyncLeaseResponse,
  SyncObjectDescriptor,
  SyncRestorePlan,
  SyncSnapshotRecord,
  SyncConflictRecord,
  SyncPlanRequest,
  SyncPlanResponse,
} from "../../lib/sync-protocol.ts";

export class SyncStoreError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "SyncStoreError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface StoredRevision {
  revision: number;
  serverSequence: number;
  deviceId: string;
  baseRevision: number;
  deleted: boolean;
  encryptedManifest: EncryptedPayload | null;
  chunkIds: string[];
  createdAt: string;
  operationId: string;
}

interface StoredObject {
  objectId: string;
  currentRevision: number;
  current: StoredRevision;
  revisions: StoredRevision[];
}

interface StoredLease {
  sessionId: string;
  deviceId: string;
  runId: string;
  expiresAt: string;
}

interface StoredConflict {
  conflictId: string;
  objectId: string;
  localRevision: number;
  remoteRevision: number;
  deviceId: string;
  createdAt: string;
  status: "open" | "resolved";
}

type StoredAuditEvent = SyncAuditRecord;

interface StoredSnapshot {
  snapshotId: string;
  createdAt: string;
  createdBy: string;
  label: string;
  objects: Record<string, number>;
}

interface StoredDevice extends SyncDeviceRecord {
  tokenHash: string;
  vaultKeyEnvelope: VaultKeyEnvelope;
}

interface StoredPairingCode {
  codeHash: string;
  vaultId: string;
  createdBy: string;
  expiresAt: string;
  used: boolean;
}

interface StoredPairingRequest {
  requestId: string;
  codeHash: string;
  vaultId: string;
  name: string;
  publicKey: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  response?: SyncAuthResponse;
}

interface StoredVault {
  vaultId: string;
  createdAt: string;
  serverEpoch: string;
  sequence: number;
  devices: Record<string, StoredDevice>;
  objects: Record<string, StoredObject>;
  changes: SyncObjectDescriptor[];
  leases: Record<string, StoredLease>;
  conflicts: Record<string, StoredConflict>;
  snapshots: Record<string, StoredSnapshot>;
  operations: Record<string, SyncCommitResponse>;
  audit: StoredAuditEvent[];
}

export interface StoreFile {
  schemaVersion: 1;
  vaults: Record<string, StoredVault>;
  pairingCodes: Record<string, StoredPairingCode>;
  pairingRequests: Record<string, StoredPairingRequest>;
}

export interface SyncPersistence {
  init(): Promise<void>;
  load(): Promise<StoreFile | null>;
  save(data: StoreFile): Promise<void>;
  putChunk(vaultId: string, chunkId: string, body: Uint8Array): Promise<void>;
  getChunk(vaultId: string, chunkId: string): Promise<Buffer | null>;
  hasChunk(vaultId: string, chunkId: string): Promise<boolean>;
}

export interface SyncAuthContext {
  vault: StoredVault;
  device: StoredDevice;
}

const now = () => new Date().toISOString();

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function token(): string {
  return `rnt_${randomBytes(32).toString("base64url")}`;
}

function pairingCode(): string {
  return randomBytes(5).toString("hex").toUpperCase();
}

function publicDevice(device: StoredDevice): SyncDeviceRecord {
  return {
    deviceId: device.deviceId,
    name: device.name,
    role: device.role,
    publicKey: device.publicKey,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    status: device.status,
  };
}

function descriptor(object: StoredObject): SyncObjectDescriptor {
  return {
    objectId: object.objectId,
    kind: object.current.encryptedManifest ? "file" : "tombstone",
    currentRevision: object.currentRevision,
    deleted: object.current.deleted,
    encryptedManifest: object.current.encryptedManifest,
    chunkIds: object.current.chunkIds,
    updatedAt: object.current.createdAt,
    updatedBy: object.current.deviceId,
  };
}

function emptyFile(): StoreFile {
  return { schemaVersion: 1, vaults: {}, pairingCodes: {}, pairingRequests: {} };
}

function publicConflict(conflict: StoredConflict): SyncConflictRecord {
  return { ...conflict };
}

function publicSnapshot(snapshot: StoredSnapshot): SyncSnapshotRecord {
  return { snapshotId: snapshot.snapshotId, createdAt: snapshot.createdAt, createdBy: snapshot.createdBy, label: snapshot.label, objectCount: Object.keys(snapshot.objects).length };
}

export class FileSyncStore {
  private data: StoreFile = emptyFile();
  private loaded = false;
  private writeLock: Promise<void> = Promise.resolve();
  private readonly rootDir: string;
  private readonly persistence: SyncPersistence | null;

  constructor(rootDir: string, persistence: SyncPersistence | null = null) { this.rootDir = rootDir; this.persistence = persistence; }

  private get statePath(): string { return join(this.rootDir, "state.json"); }
  private get chunksDir(): string { return join(this.rootDir, "chunks"); }

  async init(): Promise<void> {
    if (this.loaded) return;
    if (this.persistence) {
      await this.persistence.init();
      const stored = await this.persistence.load();
      this.data = stored ?? emptyFile();
      for (const vault of Object.values(this.data.vaults)) {
        vault.audit ??= [];
        vault.leases ??= {};
        vault.conflicts ??= {};
        vault.snapshots ??= {};
        vault.operations ??= {};
      }
      if (!stored) await this.persistence.save(this.data);
      this.loaded = true;
      return;
    }
    await mkdir(this.chunksDir, { recursive: true });
    try {
      this.data = JSON.parse(await readFile(this.statePath, "utf8")) as StoreFile;
      for (const vault of Object.values(this.data.vaults)) {
        vault.audit ??= [];
        vault.leases ??= {};
        vault.conflicts ??= {};
        vault.snapshots ??= {};
        vault.operations ??= {};
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") throw error;
      this.data = emptyFile();
      await this.persist();
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (this.persistence) {
      await this.persistence.save(this.data);
      return;
    }
    const run = this.writeLock.then(async () => {
      await mkdir(dirname(this.statePath), { recursive: true });
      const temporary = `${this.statePath}.tmp-${process.pid}`;
      await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.statePath);
    });
    this.writeLock = run.catch(() => undefined);
    await run;
  }

  private vault(vaultId: string): StoredVault {
    const vault = this.data.vaults[vaultId];
    if (!vault) throw new SyncStoreError("vault_not_found", "Sync vault not found", 404);
    return vault;
  }

  async createVault(input: { deviceId: string; deviceName: string; publicKey: string; vaultKeyEnvelope: VaultKeyEnvelope }): Promise<SyncAuthResponse> {
    await this.init();
    const vaultId = `vault_${randomUUID()}`;
    const deviceToken = token();
    const createdAt = now();
    const device: StoredDevice = {
      deviceId: input.deviceId,
      name: input.deviceName,
      role: "owner",
      publicKey: input.publicKey,
      createdAt,
      lastSeenAt: createdAt,
      status: "active",
      tokenHash: digest(deviceToken),
      vaultKeyEnvelope: input.vaultKeyEnvelope,
    };
    const vault: StoredVault = {
      vaultId,
      createdAt,
      serverEpoch: `epoch_${randomUUID()}`,
      sequence: 0,
      devices: { [device.deviceId]: device },
      objects: {},
      changes: [],
      leases: {},
      conflicts: {},
      snapshots: {},
      operations: {},
      audit: [],
    };
    this.data.vaults[vaultId] = vault;
    this.audit(vault, device.deviceId, "vault_created");
    await this.persist();
    return { vaultId, device: publicDevice(device), deviceToken, vaultKeyEnvelope: device.vaultKeyEnvelope, serverEpoch: vault.serverEpoch };
  }

  async authenticate(deviceToken: string): Promise<SyncAuthContext> {
    await this.init();
    const tokenHash = digest(deviceToken);
    for (const vault of Object.values(this.data.vaults)) {
      const device = Object.values(vault.devices).find((candidate) => candidate.tokenHash === tokenHash);
      if (!device) continue;
      if (device.status !== "active" || device.role === "revoked") throw new SyncStoreError("device_revoked", "Device has been revoked", 403);
      device.lastSeenAt = now();
      return { vault, device };
    }
    throw new SyncStoreError("unauthorized", "Invalid sync device token", 401);
  }

  private audit(vault: StoredVault, deviceId: string, action: string, details?: Record<string, string | number | boolean>): void {
    vault.audit ??= [];
    vault.audit.push({ eventId: `audit_${randomUUID()}`, action, deviceId, createdAt: now(), details });
    if (vault.audit.length > 2000) vault.audit.splice(0, vault.audit.length - 2000);
  }

  async createPairingCode(auth: SyncAuthContext): Promise<{ code: string; expiresAt: string }> {
    if (auth.device.role !== "owner") throw new SyncStoreError("forbidden", "Only the vault owner can create pairing codes", 403);
    const code = pairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.data.pairingCodes[digest(code)] = { codeHash: digest(code), vaultId: auth.vault.vaultId, createdBy: auth.device.deviceId, expiresAt, used: false };
    await this.persist();
    return { code, expiresAt };
  }

  async requestPairing(input: { code: string; name: string; publicKey: string }): Promise<{ requestId: string; expiresAt: string }> {
    await this.init();
    const entry = this.data.pairingCodes[digest(input.code.toUpperCase())];
    if (!entry || entry.used || Date.parse(entry.expiresAt) <= Date.now()) throw new SyncStoreError("pairing_expired", "Pairing code is invalid or expired", 400);
    const requestId = `pair_${randomUUID()}`;
    this.data.pairingRequests[requestId] = { requestId, codeHash: entry.codeHash, vaultId: entry.vaultId, name: input.name, publicKey: input.publicKey, createdAt: now(), status: "pending" };
    await this.persist();
    return { requestId, expiresAt: entry.expiresAt };
  }

  async approvePairing(auth: SyncAuthContext, requestId: string, vaultKeyEnvelope: VaultKeyEnvelope): Promise<SyncAuthResponse> {
    if (auth.device.role !== "owner") throw new SyncStoreError("forbidden", "Only the vault owner can approve devices", 403);
    const request = this.data.pairingRequests[requestId];
    if (!request || request.vaultId !== auth.vault.vaultId || request.status !== "pending") throw new SyncStoreError("pairing_not_found", "Pairing request is not pending", 404);
    const deviceId = `dev_${digest(request.publicKey).slice(0, 24)}`;
    if (auth.vault.devices[deviceId]) throw new SyncStoreError("device_exists", "This device is already paired", 409);
    const deviceToken = token();
    const device: StoredDevice = {
      deviceId,
      name: request.name,
      role: "full",
      publicKey: request.publicKey,
      createdAt: now(),
      lastSeenAt: now(),
      status: "active",
      tokenHash: digest(deviceToken),
      vaultKeyEnvelope,
    };
    auth.vault.devices[deviceId] = device;
    const code = this.data.pairingCodes[request.codeHash];
    if (code) code.used = true;
    const response: SyncAuthResponse = { vaultId: auth.vault.vaultId, device: publicDevice(device), deviceToken, vaultKeyEnvelope, serverEpoch: auth.vault.serverEpoch };
    request.status = "approved";
    request.response = response;
    this.audit(auth.vault, auth.device.deviceId, "device_approved", { deviceId });
    await this.persist();
    return response;
  }

  async pairingStatus(requestId: string): Promise<{ status: StoredPairingRequest["status"]; response?: SyncAuthResponse }> {
    await this.init();
    const request = this.data.pairingRequests[requestId];
    if (!request) throw new SyncStoreError("pairing_not_found", "Pairing request not found", 404);
    return { status: request.status, response: request.response };
  }

  listDevices(auth: SyncAuthContext): SyncDeviceRecord[] {
    return Object.values(auth.vault.devices).map(publicDevice);
  }

  async revokeDevice(auth: SyncAuthContext, deviceId: string): Promise<void> {
    if (auth.device.role !== "owner") throw new SyncStoreError("forbidden", "Only the vault owner can revoke devices", 403);
    if (deviceId === auth.device.deviceId) throw new SyncStoreError("invalid_device", "The owner device cannot revoke itself", 400);
    const device = auth.vault.devices[deviceId];
    if (!device) throw new SyncStoreError("device_not_found", "Device not found", 404);
    device.status = "revoked";
    device.role = "revoked";
    this.audit(auth.vault, auth.device.deviceId, "device_revoked", { deviceId });
    await this.persist();
  }

  async updateDevice(auth: SyncAuthContext, deviceId: string, input: { name?: string; role?: "full" | "read_only" }): Promise<void> {
    if (auth.device.role !== "owner") throw new SyncStoreError("forbidden", "Only the vault owner can update devices", 403);
    const device = auth.vault.devices[deviceId];
    if (!device || device.status !== "active") throw new SyncStoreError("device_not_found", "Device not found", 404);
    if (typeof input.name === "string" && input.name.trim()) device.name = input.name.trim().slice(0, 80);
    if (input.role && deviceId !== auth.device.deviceId) device.role = input.role;
    this.audit(auth.vault, auth.device.deviceId, "device_updated", { deviceId, role: device.role });
    await this.persist();
  }

  async plan(auth: SyncAuthContext, input: SyncPlanRequest & { objects: Array<SyncPlanRequest["objects"][number] & { chunkIds?: string[] }> }): Promise<SyncPlanResponse> {
    const upload: string[] = [];
    const download: SyncObjectDescriptor[] = [];
    const conflicts: SyncPlanResponse["conflicts"] = [];
    const missingChunks = new Set<string>();
    for (const local of input.objects) {
      const remote = auth.vault.objects[local.objectId];
      if (!remote) {
        upload.push(local.objectId);
        for (const chunkId of local.chunkIds ?? []) if (!(await this.hasChunk(auth.vault.vaultId, chunkId))) missingChunks.add(chunkId);
        continue;
      }
      if (local.changed) {
        upload.push(local.objectId);
        for (const chunkId of local.chunkIds ?? []) if (!(await this.hasChunk(auth.vault.vaultId, chunkId))) missingChunks.add(chunkId);
      } else if (remote.currentRevision > local.currentRevision) download.push(descriptor(remote));
      else if (remote.currentRevision < local.currentRevision) {
        upload.push(local.objectId);
        for (const chunkId of local.chunkIds ?? []) if (!(await this.hasChunk(auth.vault.vaultId, chunkId))) missingChunks.add(chunkId);
      }
    }
    for (const remote of Object.values(auth.vault.objects)) {
      if (!input.objects.some((local) => local.objectId === remote.objectId)) download.push(descriptor(remote));
    }
    for (const conflict of Object.values(auth.vault.conflicts)) if (conflict.status === "open") conflicts.push({ conflictId: conflict.conflictId, objectId: conflict.objectId, localRevision: conflict.localRevision, remoteRevision: conflict.remoteRevision });
    return { serverEpoch: auth.vault.serverEpoch, cursor: auth.vault.sequence, upload, download, conflicts, missingChunks: [...missingChunks] };
  }

  async commit(auth: SyncAuthContext, input: SyncCommitRequest): Promise<SyncCommitResponse> {
    if (auth.device.role === "read_only") throw new SyncStoreError("read_only", "Read-only devices cannot commit changes", 403);
    const previous = auth.vault.operations[input.operationId];
    if (previous) return previous;
    const existing = auth.vault.objects[input.objectId];
    const currentRevision = existing?.currentRevision ?? 0;
    if (input.baseRevision !== currentRevision) {
      const conflictId = `conf_${randomUUID()}`;
      auth.vault.conflicts[conflictId] = { conflictId, objectId: input.objectId, localRevision: input.baseRevision, remoteRevision: currentRevision, deviceId: auth.device.deviceId, createdAt: now(), status: "open" };
      this.audit(auth.vault, auth.device.deviceId, "conflict_created", { conflictId, objectId: input.objectId });
      await this.persist();
      throw new SyncStoreError("revision_conflict", "Object changed on another device", 409, { conflictId, objectId: input.objectId, currentRevision });
    }
    for (const chunkId of input.chunkIds) if (!(await this.hasChunk(auth.vault.vaultId, chunkId))) throw new SyncStoreError("missing_chunk", `Chunk ${chunkId} has not been uploaded`, 409, { chunkId });
    const createdAt = now();
    const revision: StoredRevision = {
      revision: currentRevision + 1,
      serverSequence: auth.vault.sequence + 1,
      deviceId: auth.device.deviceId,
      baseRevision: input.baseRevision,
      deleted: input.deleted,
      encryptedManifest: input.encryptedManifest,
      chunkIds: [...input.chunkIds],
      createdAt,
      operationId: input.operationId,
    };
    const object: StoredObject = existing ?? { objectId: input.objectId, currentRevision: 0, current: revision, revisions: [] };
    object.currentRevision = revision.revision;
    object.current = revision;
    object.revisions.push(revision);
    auth.vault.objects[input.objectId] = object;
    auth.vault.sequence = revision.serverSequence;
    const response: SyncCommitResponse = { objectId: input.objectId, revision: revision.revision, serverSequence: revision.serverSequence, updatedAt: createdAt };
    auth.vault.operations[input.operationId] = response;
    auth.vault.changes.push(descriptor(object));
    this.audit(auth.vault, auth.device.deviceId, "object_committed", { objectId: input.objectId, revision: revision.revision });
    await this.persist();
    return response;
  }

  async changes(auth: SyncAuthContext, cursor: number, limit = 100): Promise<SyncChangePage> {
    const changes = auth.vault.changes.filter((change) => change.updatedAt && change.currentRevision > 0).slice(Math.max(0, cursor), Math.max(0, cursor) + Math.min(limit, 500));
    const nextCursor = Math.min(auth.vault.changes.length, Math.max(0, cursor) + changes.length);
    return { cursor: nextCursor, changes, hasMore: nextCursor < auth.vault.changes.length, serverEpoch: auth.vault.serverEpoch };
  }

  async putChunk(vaultId: string, chunkId: string, body: Uint8Array): Promise<{ chunkId: string; bytes: number }> {
    await this.init();
    this.vault(vaultId);
    if (!/^chk_[a-f0-9]{64}$/.test(chunkId)) throw new SyncStoreError("invalid_chunk", "Invalid chunk id", 400);
    if (this.persistence) {
      await this.persistence.putChunk(vaultId, chunkId, body);
      return { chunkId, bytes: body.byteLength };
    }
    const path = join(this.chunksDir, `${vaultId}-${chunkId}.bin`);
    try { await stat(path); return { chunkId, bytes: body.byteLength }; } catch { /* missing, write below */ }
    await writeFile(path, Buffer.from(body), { flag: "wx", mode: 0o600 }).catch((error: unknown) => {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "EEXIST") throw error;
    });
    return { chunkId, bytes: body.byteLength };
  }

  async getChunk(vaultId: string, chunkId: string): Promise<Buffer> {
    this.vault(vaultId);
    if (!/^chk_[a-f0-9]{64}$/.test(chunkId)) throw new SyncStoreError("invalid_chunk", "Invalid chunk id", 400);
    if (this.persistence) {
      const body = await this.persistence.getChunk(vaultId, chunkId);
      if (!body) throw new SyncStoreError("chunk_not_found", "Chunk not found", 404);
      return body;
    }
    try { return await readFile(join(this.chunksDir, `${vaultId}-${chunkId}.bin`)); } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT") throw new SyncStoreError("chunk_not_found", "Chunk not found", 404);
      throw error;
    }
  }

  async hasChunk(vaultId: string, chunkId: string): Promise<boolean> {
    if (this.persistence) return this.persistence.hasChunk(vaultId, chunkId);
    try { await stat(join(this.chunksDir, `${vaultId}-${chunkId}.bin`)); return true; } catch { return false; }
  }

  async acquireLease(auth: SyncAuthContext, sessionId: string, runId: string, ttlMs = 90_000): Promise<SyncLeaseResponse> {
    const existing = auth.vault.leases[sessionId];
    if (existing && Date.parse(existing.expiresAt) > Date.now() && existing.deviceId !== auth.device.deviceId) throw new SyncStoreError("lease_busy", "This session is active on another device", 409, existing);
    const lease = { sessionId, deviceId: auth.device.deviceId, runId, expiresAt: new Date(Date.now() + Math.min(Math.max(ttlMs, 10_000), 10 * 60_000)).toISOString() };
    auth.vault.leases[sessionId] = lease;
    await this.persist();
    return lease;
  }

  async releaseLease(auth: SyncAuthContext, sessionId: string): Promise<void> {
    const existing = auth.vault.leases[sessionId];
    if (existing?.deviceId === auth.device.deviceId) { delete auth.vault.leases[sessionId]; await this.persist(); }
  }

  async createSnapshot(auth: SyncAuthContext, label: string): Promise<StoredSnapshot> {
    const snapshot: StoredSnapshot = { snapshotId: `snap_${randomUUID()}`, createdAt: now(), createdBy: auth.device.deviceId, label, objects: Object.fromEntries(Object.values(auth.vault.objects).map((object) => [object.objectId, object.currentRevision])) };
    auth.vault.snapshots[snapshot.snapshotId] = snapshot;
    const snapshots = Object.values(auth.vault.snapshots).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const old of snapshots.slice(0, Math.max(0, snapshots.length - 100))) delete auth.vault.snapshots[old.snapshotId];
    this.audit(auth.vault, auth.device.deviceId, "snapshot_created", { snapshotId: snapshot.snapshotId });
    await this.persist();
    return snapshot;
  }

  async rotateEpoch(auth: SyncAuthContext): Promise<{ serverEpoch: string }> {
    if (auth.device.role !== "owner") throw new SyncStoreError("forbidden", "Only the vault owner can rotate the server epoch", 403);
    auth.vault.serverEpoch = `epoch_${randomUUID()}`;
    this.audit(auth.vault, auth.device.deviceId, "server_epoch_rotated", { serverEpoch: auth.vault.serverEpoch });
    await this.persist();
    return { serverEpoch: auth.vault.serverEpoch };
  }

  listSnapshots(auth: SyncAuthContext): SyncSnapshotRecord[] { return Object.values(auth.vault.snapshots).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicSnapshot); }

  listConflicts(auth: SyncAuthContext): SyncConflictRecord[] {
    return Object.values(auth.vault.conflicts).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicConflict);
  }

  listAudit(auth: SyncAuthContext): SyncAuditRecord[] {
    return [...(auth.vault.audit ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
  }

  restorePlan(auth: SyncAuthContext, snapshotId: string): SyncRestorePlan {
    const snapshot = auth.vault.snapshots[snapshotId];
    if (!snapshot) throw new SyncStoreError("snapshot_not_found", "Snapshot not found", 404);
    const affected: SyncRestorePlan["affected"] = [];
    for (const [objectId, targetRevision] of Object.entries(snapshot.objects)) {
      const current = auth.vault.objects[objectId];
      if (!current || current.currentRevision === targetRevision) continue;
      const historical = current.revisions.find((revision) => revision.revision === targetRevision);
      if (historical) affected.push({ objectId, fromRevision: current.currentRevision, toRevision: targetRevision, deleted: historical.deleted });
    }
    for (const object of Object.values(auth.vault.objects)) {
      if (snapshot.objects[object.objectId] !== undefined) continue;
      if (!object.current.deleted) affected.push({ objectId: object.objectId, fromRevision: object.currentRevision, toRevision: 0, deleted: true });
    }
    return { snapshotId, affected };
  }

  async restoreSnapshot(auth: SyncAuthContext, snapshotId: string, confirm: boolean): Promise<{ restored: number; snapshotId: string }> {
    if (!confirm) throw new SyncStoreError("confirmation_required", "Snapshot restore requires confirm=true", 400);
    if (auth.device.role === "read_only") throw new SyncStoreError("read_only", "Read-only devices cannot restore snapshots", 403);
    const plan = this.restorePlan(auth, snapshotId);
    const recovery = await this.createSnapshot(auth, `before restore ${snapshotId}`);
    for (const item of plan.affected) {
      const object = auth.vault.objects[item.objectId];
      const historical = object?.revisions.find((revision) => revision.revision === item.toRevision);
      if (!object) continue;
      if (item.toRevision > 0 && !historical) continue;
      const createdAt = now();
      const revision: StoredRevision = historical
        ? { ...historical, revision: object.currentRevision + 1, baseRevision: object.currentRevision, serverSequence: auth.vault.sequence + 1, deviceId: auth.device.deviceId, createdAt, operationId: `restore_${randomUUID()}` }
        : { revision: object.currentRevision + 1, baseRevision: object.currentRevision, serverSequence: auth.vault.sequence + 1, deviceId: auth.device.deviceId, createdAt, operationId: `restore_${randomUUID()}`, deleted: true, encryptedManifest: null, chunkIds: [] };
      object.currentRevision = revision.revision;
      object.current = revision;
      object.revisions.push(revision);
      auth.vault.sequence = revision.serverSequence;
      auth.vault.changes.push(descriptor(object));
      this.audit(auth.vault, auth.device.deviceId, "snapshot_object_restored", { objectId: item.objectId, snapshotId });
    }
    this.audit(auth.vault, auth.device.deviceId, "snapshot_restored", { snapshotId, restored: plan.affected.length, recoverySnapshotId: recovery.snapshotId });
    await this.persist();
    return { restored: plan.affected.length, snapshotId: recovery.snapshotId };
  }

  async resolveConflict(auth: SyncAuthContext, conflictId: string, keepRevision: "local" | "remote"): Promise<void> {
    const conflict = auth.vault.conflicts[conflictId];
    if (!conflict || conflict.status !== "open") throw new SyncStoreError("conflict_not_found", "Conflict is not open", 404);
    if (keepRevision === "remote") conflict.status = "resolved";
    else throw new SyncStoreError("local_resolution_required", "Local resolution must submit a new revision from the client", 409);
    this.audit(auth.vault, auth.device.deviceId, "conflict_resolved", { conflictId, keepRevision });
    await this.persist();
  }
}
