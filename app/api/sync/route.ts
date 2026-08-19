import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { approvePairing, completePairing, createPairingCode, createVault, downloadRemoteChanges, getLocalSyncDevice, listSyncAudit, listSyncConflicts, listSyncDevices, listSyncSnapshots, pairingStatus, previewSyncRestore, requestJson, requestPairing, resolveSyncConflict, restoreSyncSnapshot, syncPlan, updateSyncDevice, uploadLocalChanges } from "@/lib/sync-client";
import type { LocalSyncDevice } from "@/lib/sync-device";
import type { SyncAuthResponse } from "@/lib/sync-protocol";
import { scanAgentData } from "@/lib/sync-scanner";
import { readSyncState, summarizeScan, writeLocalManifest, writeSyncState } from "@/lib/sync-state";
import { readWorkspaceMappings, writeWorkspaceMappings, type SyncWorkspaceMapping } from "@/lib/sync-workspaces";

export const dynamic = "force-dynamic";

function response(agentDir: string, state: Awaited<ReturnType<typeof readSyncState>>, extra: Record<string, unknown> = {}) {
  const connected = state.connection.status === "connected" || state.connection.status === "syncing" || state.connection.status === "conflict";
  return { ...state, agentRootName: agentDir.split(/[\\/]/).pop() ?? "agent", phase: connected ? "ready" : state.connection.status === "pairing" ? "pairing" : "local-preview", uploadEnabled: connected, ...extra };
}

function safeDevice(device: LocalSyncDevice | null) {
  if (!device) return null;
  return { deviceId: device.deviceId, name: device.name, publicKey: device.publicKey, vaultId: device.vaultId, serverEpoch: device.serverEpoch };
}

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => ({})) as unknown;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

export async function GET() {
  try {
    const agentDir = getAgentDir();
    return NextResponse.json(response(agentDir, await readSyncState(agentDir), { device: safeDevice(await getLocalSyncDevice(agentDir)) }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read sync state" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const agentDir = getAgentDir();
  try {
    const body = await bodyOf(request);
    const action = typeof body.action === "string" ? body.action : "scan";
    if (action === "scan") {
      const { manifest, summary } = await scanAgentData(agentDir);
      await writeLocalManifest(agentDir, manifest);
      const current = await readSyncState(agentDir);
      const next = { ...current, lastScan: summarizeScan(summary) };
      await writeSyncState(agentDir, next);
      return NextResponse.json(response(agentDir, next));
    }

    if (action === "create-vault") {
      const device = await createVault(requiredString(body, "endpoint"), agentDir, typeof body.deviceName === "string" && body.deviceName ? body.deviceName : "RANOA device");
      return NextResponse.json(response(agentDir, await readSyncState(agentDir), { device: safeDevice(device) }));
    }

    if (action === "pair-request") {
      const endpoint = requiredString(body, "endpoint");
      const result = await requestPairing(endpoint, agentDir, requiredString(body, "code"), typeof body.deviceName === "string" && body.deviceName ? body.deviceName : "RANOA device");
      const state = await readSyncState(agentDir);
      await writeSyncState(agentDir, { ...state, connection: { ...state.connection, status: "pairing", endpoint } });
      return NextResponse.json({ ...response(agentDir, await readSyncState(agentDir), { device: safeDevice(await getLocalSyncDevice(agentDir)) }), ...result, devicePublicKey: (await getLocalSyncDevice(agentDir))?.publicKey ?? null });
    }

    if (action === "pair-status") {
      const endpoint = requiredString(body, "endpoint");
      const pairing = await pairingStatus(endpoint, requiredString(body, "requestId"));
      if (pairing.status === "approved" && pairing.response) {
        const completed = await completePairing(endpoint, agentDir, pairing.response, typeof body.deviceName === "string" && body.deviceName ? body.deviceName : "RANOA device");
        return NextResponse.json({ status: "approved", ...response(agentDir, await readSyncState(agentDir), { device: safeDevice(completed) }) });
      }
      return NextResponse.json({ status: pairing.status });
    }

    if (action === "pair-approve") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("This device is not paired as the vault owner");
      await approvePairing(requiredString(body, "endpoint"), device, requiredString(body, "requestId"), requiredString(body, "newDevicePublicKey"));
      return NextResponse.json({ status: "approved" });
    }

    if (action === "pair-complete") {
      const result = await completePairing(requiredString(body, "endpoint"), agentDir, body.response as SyncAuthResponse, typeof body.deviceName === "string" && body.deviceName ? body.deviceName : "RANOA device");
      return NextResponse.json(response(agentDir, await readSyncState(agentDir), { device: safeDevice(result) }));
    }

    if (action === "plan") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before creating a sync plan");
      return NextResponse.json(await syncPlan(requiredString(body, "endpoint"), agentDir, device));
    }

    if (action === "upload") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before uploading");
      const endpoint = requiredString(body, "endpoint");
      const result = await uploadLocalChanges(endpoint, agentDir, device);
      const state = await readSyncState(agentDir);
      await writeSyncState(agentDir, { ...state, connection: { ...state.connection, status: result.conflicts ? "conflict" : "connected", endpoint } });
      return NextResponse.json({ ...result, ...response(agentDir, await readSyncState(agentDir)) });
    }

    if (action === "download") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before downloading");
      const endpoint = requiredString(body, "endpoint");
      const result = await downloadRemoteChanges(endpoint, agentDir, device);
      const state = await readSyncState(agentDir);
      await writeSyncState(agentDir, { ...state, connection: { ...state.connection, status: "connected", endpoint } });
      return NextResponse.json({ ...result, ...response(agentDir, await readSyncState(agentDir)) });
    }

    if (action === "devices") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before listing devices");
      return NextResponse.json(await listSyncDevices(requiredString(body, "endpoint"), device));
    }

    if (action === "device-update") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before managing devices");
      await updateSyncDevice(requiredString(body, "endpoint"), device, requiredString(body, "deviceId"), { action: body.deviceAction === "revoke" ? "revoke" : "update", name: typeof body.name === "string" ? body.name : undefined, role: body.role === "read_only" || body.role === "full" ? body.role : undefined });
      return NextResponse.json({ ok: true });
    }

    if (action === "conflicts") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before listing conflicts");
      return NextResponse.json(await listSyncConflicts(requiredString(body, "endpoint"), device));
    }

    if (action === "resolve-conflict") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before resolving conflicts");
      await resolveSyncConflict(requiredString(body, "endpoint"), device, requiredString(body, "conflictId"), body.keepRevision === "local" ? "local" : "remote");
      return NextResponse.json({ ok: true });
    }

    if (action === "snapshots") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before listing snapshots");
      return NextResponse.json(await listSyncSnapshots(requiredString(body, "endpoint"), device));
    }

    if (action === "restore-preview") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before previewing a restore");
      return NextResponse.json(await previewSyncRestore(requiredString(body, "endpoint"), device, requiredString(body, "snapshotId")));
    }

    if (action === "restore") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before restoring a snapshot");
      return NextResponse.json(await restoreSyncSnapshot(requiredString(body, "endpoint"), device, requiredString(body, "snapshotId")));
    }

    if (action === "audit") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before reading the audit log");
      return NextResponse.json(await listSyncAudit(requiredString(body, "endpoint"), device));
    }

    if (action === "rotate-epoch") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before rotating the server epoch");
      return NextResponse.json((await requestJson<{ serverEpoch: string }>(requiredString(body, "endpoint"), "/v1/epoch/rotate", { method: "POST", body: JSON.stringify({}) }, device.deviceToken)).value);
    }

    if (action === "workspace-mappings") return NextResponse.json({ mappings: await readWorkspaceMappings(agentDir) });

    if (action === "save-workspace-mappings") {
      if (!Array.isArray(body.mappings)) throw new Error("mappings must be an array");
      return NextResponse.json({ mappings: await writeWorkspaceMappings(agentDir, body.mappings as SyncWorkspaceMapping[]) });
    }

    if (action === "create-code") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before creating a code");
      return NextResponse.json(await createPairingCode(requiredString(body, "endpoint"), device));
    }

    throw new Error(`Unknown sync action: ${action}`);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run sync action" }, { status });
  }
}
