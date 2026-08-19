import { readFile } from "node:fs/promises";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSyncDir } from "./sync-state.ts";

export interface SyncWorkspaceMapping {
  workspaceId: string;
  localPath: string;
  gitRemoteFingerprint?: string;
  lastVerifiedAt?: string;
}

function pathFor(agentDir: string): string { return join(getSyncDir(agentDir), "workspace-mappings.json"); }

async function writeAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export async function readWorkspaceMappings(agentDir: string): Promise<SyncWorkspaceMapping[]> {
  try {
    const value = JSON.parse(await readFile(pathFor(agentDir), "utf8")) as unknown;
    return Array.isArray(value) ? value.filter((item): item is SyncWorkspaceMapping => Boolean(item && typeof item === "object" && typeof (item as SyncWorkspaceMapping).workspaceId === "string" && typeof (item as SyncWorkspaceMapping).localPath === "string")) : [];
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return [];
    throw error;
  }
}

export async function writeWorkspaceMappings(agentDir: string, mappings: SyncWorkspaceMapping[]): Promise<SyncWorkspaceMapping[]> {
  const next = mappings.slice(0, 200).map((mapping) => ({ workspaceId: mapping.workspaceId.trim().slice(0, 120), localPath: mapping.localPath.trim().slice(0, 1000), gitRemoteFingerprint: mapping.gitRemoteFingerprint?.trim().slice(0, 200), lastVerifiedAt: mapping.lastVerifiedAt ?? new Date().toISOString() }));
  await writeAtomically(pathFor(agentDir), next);
  return next;
}
