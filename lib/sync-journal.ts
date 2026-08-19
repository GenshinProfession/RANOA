import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSyncDir } from "./sync-state.ts";

export interface LocalSyncObjectRecord {
  objectId: string;
  path: string;
  revision: number;
  deleted: boolean;
  sha256: string | null;
  chunkIds: string[];
}

export interface LocalSyncJournal {
  schemaVersion: 1;
  cursor: number;
  serverEpoch: string | null;
  objects: Record<string, LocalSyncObjectRecord>;
}

function journalPath(agentDir: string): string { return join(getSyncDir(agentDir), "journal.json"); }

export function emptySyncJournal(): LocalSyncJournal {
  return { schemaVersion: 1, cursor: 0, serverEpoch: null, objects: {} };
}

export async function readSyncJournal(agentDir: string): Promise<LocalSyncJournal> {
  try {
    const parsed = JSON.parse(await readFile(journalPath(agentDir), "utf8")) as Partial<LocalSyncJournal>;
    return {
      ...emptySyncJournal(),
      ...parsed,
      objects: { ...(parsed.objects ?? {}) },
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return emptySyncJournal();
    throw error;
  }
}
