import type { EncryptedChunk, EncryptedPayload, VaultKeyEnvelope } from "./sync-crypto.ts";

export const SYNC_PROTOCOL_VERSION = 1;

export type SyncDeviceRole = "owner" | "full" | "read_only" | "revoked";

export interface SyncDeviceRecord {
  deviceId: string;
  name: string;
  role: SyncDeviceRole;
  publicKey: string;
  createdAt: string;
  lastSeenAt: string | null;
  status: "active" | "revoked";
}

export interface SyncAuthResponse {
  vaultId: string;
  device: SyncDeviceRecord;
  deviceToken: string;
  vaultKeyEnvelope: VaultKeyEnvelope;
  serverEpoch: string;
}

export interface SyncObjectDescriptor {
  objectId: string;
  kind: "file" | "session" | "settings" | "tombstone";
  currentRevision: number;
  deleted: boolean;
  encryptedManifest: EncryptedPayload | null;
  chunkIds: string[];
  updatedAt: string;
  updatedBy: string;
}

export interface SyncPlanRequest {
  schemaVersion: number;
  cursor: number;
  objects: Array<Pick<SyncObjectDescriptor, "objectId" | "currentRevision" | "deleted">>;
}

export interface SyncPlanResponse {
  serverEpoch: string;
  cursor: number;
  upload: string[];
  download: SyncObjectDescriptor[];
  conflicts: Array<{ conflictId: string; objectId: string; localRevision: number; remoteRevision: number }>;
  missingChunks: string[];
}

export interface SyncCommitRequest {
  operationId: string;
  objectId: string;
  baseRevision: number;
  schemaVersion: number;
  deleted: boolean;
  encryptedManifest: EncryptedPayload | null;
  chunkIds: string[];
}

export interface SyncCommitResponse {
  objectId: string;
  revision: number;
  serverSequence: number;
  updatedAt: string;
}

export interface SyncChangePage {
  cursor: number;
  changes: SyncObjectDescriptor[];
  hasMore: boolean;
  serverEpoch: string;
}

export interface SyncLeaseResponse {
  sessionId: string;
  deviceId: string;
  runId: string;
  expiresAt: string;
}

export interface SyncChunkUpload extends EncryptedChunk {
  vaultId?: string;
}
