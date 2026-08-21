import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSyncDir } from "./sync-state.ts";
export { endpointFromHostPort, parseSyncEndpoint } from "./sync-connection-shared.ts";

export interface SyncConnectionProfile {
  schemaVersion: 1;
  host: string;
  port: number;
  username: string;
  password: string;
  deviceName: string;
}

export interface SafeSyncConnectionProfile extends Omit<SyncConnectionProfile, "password"> {
  hasPassword: boolean;
}

function profilePath(agentDir: string): string {
  return join(getSyncDir(agentDir), "connection.json");
}

export async function readSyncConnection(agentDir: string): Promise<SyncConnectionProfile | null> {
  try {
    return JSON.parse(await readFile(profilePath(agentDir), "utf8")) as SyncConnectionProfile;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function writeSyncConnection(agentDir: string, profile: SyncConnectionProfile): Promise<void> {
  const path = profilePath(agentDir);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export function safeSyncConnection(profile: SyncConnectionProfile | null): SafeSyncConnectionProfile | null {
  if (!profile) return null;
  const { password, ...safe } = profile;
  return { ...safe, hasPassword: Boolean(password) };
}
