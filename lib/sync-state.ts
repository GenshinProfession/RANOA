import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LocalSyncManifest, SyncScanSummary, SyncState } from "./sync-types";

export function getSyncDir(agentDir: string): string {
  return join(dirname(agentDir), ".ranoa-sync");
}

function statePath(agentDir: string): string {
  return join(getSyncDir(agentDir), "state.json");
}

function manifestPath(agentDir: string): string {
  return join(getSyncDir(agentDir), "local-manifest.json");
}

export function createDefaultSyncState(): SyncState {
  return {
    schemaVersion: 1,
    connection: { status: "disconnected", endpoint: null, vaultId: null, deviceId: null },
    lastScan: null,
  };
}

export async function readSyncState(agentDir: string): Promise<SyncState> {
  try {
    const raw = await readFile(statePath(agentDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      ...createDefaultSyncState(),
      ...parsed,
      connection: { ...createDefaultSyncState().connection, ...(parsed.connection ?? {}) },
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return createDefaultSyncState();
    throw error;
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export async function writeSyncState(agentDir: string, state: SyncState): Promise<void> {
  await writeJsonAtomically(statePath(agentDir), state);
}

export async function writeLocalManifest(agentDir: string, manifest: LocalSyncManifest): Promise<void> {
  await writeJsonAtomically(manifestPath(agentDir), manifest);
}

export async function readLocalManifest(agentDir: string): Promise<LocalSyncManifest | null> {
  try {
    return JSON.parse(await readFile(manifestPath(agentDir), "utf8")) as LocalSyncManifest;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export function summarizeScan(summary: SyncScanSummary): SyncScanSummary {
  return {
    files: summary.files,
    bytes: summary.bytes,
    categories: summary.categories.map((category) => ({ ...category })),
    skipped: summary.skipped.map((item) => ({ ...item })),
    manifestSha256: summary.manifestSha256,
    scannedAt: summary.scannedAt,
  };
}
