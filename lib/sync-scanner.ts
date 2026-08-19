import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type { LocalSyncEntry, LocalSyncManifest, SyncCategory, SyncCategorySummary, SyncScanSummary } from "./sync-types";

const ROOTS: Array<{ category: SyncCategory; path: string }> = [
  { category: "sessions", path: "sessions" },
  { category: "skills", path: "skills" },
  { category: "extensions", path: "extensions" },
];

const FILES: Array<{ category: SyncCategory; path: string }> = [
  { category: "models", path: "models.json" },
  { category: "settings", path: "settings.json" },
];

const SKIPPED = [
  { path: "auth.json", reason: "credentials" as const },
  { path: "trust.json", reason: "device-local" as const },
  { path: "models-store.json", reason: "cache" as const },
  { path: "bin", reason: "platform-specific" as const },
  { path: "npm", reason: "platform-specific" as const },
];

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function addFile(agentDir: string, path: string, category: SyncCategory): Promise<LocalSyncEntry | null> {
  const absolutePath = join(agentDir, path);
  try {
    const info = await lstat(absolutePath);
    if (!info.isFile()) return null;
    return {
      path: path.split(sep).join("/"),
      category,
      size: info.size,
      sha256: await hashFile(absolutePath),
      modifiedAt: info.mtime.toISOString(),
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function walkFiles(agentDir: string, root: string, category: SyncCategory): Promise<LocalSyncEntry[]> {
  const output: LocalSyncEntry[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    let items;
    try {
      items = await readdir(join(agentDir, current), { withFileTypes: true });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT") continue;
      throw error;
    }
    items.sort((left, right) => left.name.localeCompare(right.name));
    for (const item of items) {
      const child = join(current, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) pending.push(child);
      else if (item.isFile()) {
        const entry = await addFile(agentDir, child, category);
        if (entry) output.push(entry);
      }
    }
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

function buildCategorySummary(entries: LocalSyncEntry[]): SyncCategorySummary[] {
  const summaries = new Map<SyncCategory, SyncCategorySummary>();
  for (const entry of entries) {
    const current = summaries.get(entry.category) ?? { category: entry.category, files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += entry.size;
    summaries.set(entry.category, current);
  }
  return [...summaries.values()].sort((left, right) => left.category.localeCompare(right.category));
}

export async function scanAgentData(agentDir: string): Promise<{ manifest: LocalSyncManifest; summary: SyncScanSummary }> {
  const entries: LocalSyncEntry[] = [];
  for (const file of FILES) {
    const entry = await addFile(agentDir, file.path, file.category);
    if (entry) entries.push(entry);
  }
  for (const root of ROOTS) entries.push(...await walkFiles(agentDir, root.path, root.category));
  entries.sort((left, right) => left.path.localeCompare(right.path));

  const generatedAt = new Date().toISOString();
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 1, entries })).digest("hex");
  const manifest: LocalSyncManifest = {
    schemaVersion: 1,
    generatedAt,
    entries,
    totalBytes,
    manifestSha256: digest,
  };
  const summary: SyncScanSummary = {
    files: entries.length,
    bytes: totalBytes,
    categories: buildCategorySummary(entries),
    skipped: SKIPPED.map((item) => ({ ...item })),
    manifestSha256: digest,
    scannedAt: generatedAt,
  };
  return { manifest, summary };
}

export function relativeSyncPath(agentDir: string, absolutePath: string): string {
  return relative(agentDir, absolutePath).split(sep).join("/");
}

export function syncRootName(agentDir: string): string {
  return basename(agentDir);
}
