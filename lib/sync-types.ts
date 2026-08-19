export type SyncCategory = "sessions" | "models" | "settings" | "skills" | "extensions";

export interface LocalSyncEntry {
  path: string;
  category: SyncCategory;
  size: number;
  sha256: string;
  modifiedAt: string;
}

export interface LocalSyncManifest {
  schemaVersion: 1;
  generatedAt: string;
  entries: LocalSyncEntry[];
  totalBytes: number;
  manifestSha256: string;
}

export interface SyncCategorySummary {
  category: SyncCategory;
  files: number;
  bytes: number;
}

export interface SyncScanSummary {
  files: number;
  bytes: number;
  categories: SyncCategorySummary[];
  skipped: Array<{ path: string; reason: "credentials" | "cache" | "device-local" | "platform-specific" }>;
  manifestSha256: string | null;
  scannedAt: string | null;
}

export type SyncConnectionStatus = "disconnected" | "pairing" | "connected" | "offline" | "syncing" | "conflict";

export interface SyncState {
  schemaVersion: 1;
  connection: {
    status: SyncConnectionStatus;
    endpoint: string | null;
    vaultId: string | null;
    deviceId: string | null;
  };
  lastScan: SyncScanSummary | null;
}
