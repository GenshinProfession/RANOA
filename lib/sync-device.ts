import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { generateDeviceKeyPair, generateVaultKey, type DeviceKeyPair } from "./sync-crypto.ts";

export interface LocalSyncDevice extends DeviceKeyPair {
  name: string;
  vaultId: string | null;
  deviceToken: string | null;
  vaultKey: string | null;
  serverEpoch: string | null;
}

function devicePath(syncDir: string): string {
  return join(syncDir, "device.json");
}

async function writeAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export async function readLocalSyncDevice(syncDir: string): Promise<LocalSyncDevice | null> {
  try {
    return JSON.parse(await readFile(devicePath(syncDir), "utf8")) as LocalSyncDevice;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function getOrCreateLocalSyncDevice(syncDir: string, name = "RANOA device"): Promise<LocalSyncDevice> {
  const current = await readLocalSyncDevice(syncDir);
  if (current) return current;
  const identity = generateDeviceKeyPair();
  const device: LocalSyncDevice = {
    ...identity,
    name,
    vaultId: null,
    deviceToken: null,
    vaultKey: null,
    serverEpoch: null,
  };
  await writeLocalSyncDevice(syncDir, device);
  return device;
}

export async function writeLocalSyncDevice(syncDir: string, device: LocalSyncDevice): Promise<void> {
  await writeAtomically(devicePath(syncDir), device);
}

export function localVaultKey(device: LocalSyncDevice): Buffer {
  if (!device.vaultKey) throw new Error("This device is not paired with a sync vault");
  return Buffer.from(device.vaultKey, "base64url");
}

export function createLocalVaultState(device: LocalSyncDevice, vaultId: string, deviceToken: string, vaultKey: Uint8Array, serverEpoch: string): LocalSyncDevice {
  return {
    ...device,
    vaultId,
    deviceToken,
    vaultKey: Buffer.from(vaultKey).toString("base64url"),
    serverEpoch,
  };
}

export function freshVaultKey(): Buffer {
  return generateVaultKey();
}
