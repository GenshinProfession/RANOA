import { open, rm } from "node:fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { downloadRemoteChanges, getLocalSyncDevice, syncPlan, uploadLocalChanges } from "../lib/sync-client.ts";
import { scanAgentData } from "../lib/sync-scanner.ts";
import { getSyncDir, readSyncState, writeLocalManifest, writeSyncState } from "../lib/sync-state.ts";

const intervalMs = Math.max(15_000, Number(process.env.RANOA_SYNC_INTERVAL_MS ?? 60_000));
const once = process.argv.includes("--once");

async function withLock<T>(agentDir: string, action: () => Promise<T>): Promise<T | null> {
  const lockPath = `${getSyncDir(agentDir)}/agent.lock`;
  let handle;
  try { handle = await open(lockPath, "wx"); } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "EEXIST") return null;
    throw error;
  }
  try { return await action(); } finally { await handle.close(); await rm(lockPath, { force: true }); }
}

async function runOnce(): Promise<{ uploaded: number; downloaded: number; conflicts: number }> {
  const agentDir = getAgentDir();
  const state = await readSyncState(agentDir);
  const endpoint = state.connection.endpoint;
  const device = await getLocalSyncDevice(agentDir);
  if (!endpoint || !device?.deviceToken || !device.vaultKey) return { uploaded: 0, downloaded: 0, conflicts: 0 };
  return (await withLock(agentDir, async () => {
    await writeSyncState(agentDir, { ...state, connection: { ...state.connection, status: "syncing" } });
    const { manifest } = await scanAgentData(agentDir);
    await writeLocalManifest(agentDir, manifest);
    const plan = await syncPlan(endpoint, agentDir, device);
    if (plan.conflicts.length > 0) {
      await writeSyncState(agentDir, { ...state, lastScan: { ...(state.lastScan ?? { files: manifest.entries.length, bytes: manifest.totalBytes, categories: [], skipped: [], manifestSha256: manifest.manifestSha256, scannedAt: manifest.generatedAt }), manifestSha256: manifest.manifestSha256, scannedAt: manifest.generatedAt }, connection: { ...state.connection, status: "conflict" } });
      return { uploaded: 0, downloaded: 0, conflicts: plan.conflicts.length };
    }
    const uploaded = plan.upload.length ? (await uploadLocalChanges(endpoint, agentDir, device)).uploaded : 0;
    const downloaded = plan.download.length ? (await downloadRemoteChanges(endpoint, agentDir, device, plan)).downloaded : 0;
    const fresh = await readSyncState(agentDir);
    await writeSyncState(agentDir, { ...fresh, connection: { ...fresh.connection, status: "connected" } });
    return { uploaded, downloaded, conflicts: 0 };
  })) ?? { uploaded: 0, downloaded: 0, conflicts: 0 };
}

async function main(): Promise<void> {
  const run = async () => {
    try {
      const result = await runOnce();
      if (result.uploaded || result.downloaded || result.conflicts) console.log(`[ranoa-sync-agent] uploaded=${result.uploaded} downloaded=${result.downloaded} conflicts=${result.conflicts}`);
    } catch (error) {
      console.error(`[ranoa-sync-agent] ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await run();
  if (!once) setInterval(() => void run(), intervalMs);
}

void main();
