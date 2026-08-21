import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { approvePairing, completePairing, createPairingCode, createVault, downloadRemoteChanges, getLocalSyncDevice, listSyncAudit, listSyncConflicts, listSyncDevices, listSyncSnapshots, pairingStatus, previewSyncRestore, requestJson, requestPairing, resolveSyncConflict, restoreSyncSnapshot, syncPlan, updateSyncDevice, uploadLocalChanges, type SyncRemoteAuth } from "@/lib/sync-client";
import type { LocalSyncDevice } from "@/lib/sync-device";
import type { SyncAuthResponse } from "@/lib/sync-protocol";
import { scanAgentData } from "@/lib/sync-scanner";
import { readSyncState, summarizeScan, writeLocalManifest, writeSyncState } from "@/lib/sync-state";
import { endpointFromHostPort, parseSyncEndpoint, readSyncConnection, safeSyncConnection, writeSyncConnection, type SyncConnectionProfile } from "@/lib/sync-connection";
import { readWorkspaceMappings, writeWorkspaceMappings, type SyncWorkspaceMapping } from "@/lib/sync-workspaces";

export const dynamic = "force-dynamic";

function response(agentDir: string, state: Awaited<ReturnType<typeof readSyncState>>, extra: Record<string, unknown> = {}) {
  const connected = state.connection.status === "connected" || state.connection.status === "syncing" || state.connection.status === "conflict";
  return { ...state, agentRootName: agentDir.split(/[\\/]/).pop() ?? "agent", phase: connected ? "ready" : state.connection.status === "pairing" ? "pairing" : "local-preview", uploadEnabled: connected, ...extra };
}

async function responseWithConnection(agentDir: string, state: Awaited<ReturnType<typeof readSyncState>>, extra: Record<string, unknown> = {}) {
  return response(agentDir, state, { connectionProfile: safeSyncConnection(await readSyncConnection(agentDir)), ...extra });
}

async function prepareConnection(agentDir: string, body: Record<string, unknown>): Promise<{ endpoint: string; auth?: SyncRemoteAuth }> {
  const saved = await readSyncConnection(agentDir);
  const legacy = parseSyncEndpoint(typeof body.endpoint === "string" ? body.endpoint : saved?.host ? endpointFromHostPort(saved.host, saved.port) : null);
  const host = typeof body.host === "string" && body.host.trim() ? body.host.trim() : saved?.host || legacy.host;
  const port = Number(body.port) || saved?.port || legacy.port || 34141;
  const endpoint = typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim().replace(/\/+$/, "") : endpointFromHostPort(host, port);
  const username = typeof body.username === "string" ? body.username.trim() : saved?.username ?? "";
  const password = typeof body.password === "string" && body.password ? body.password : saved?.password ?? "";
  const deviceName = typeof body.deviceName === "string" && body.deviceName.trim() ? body.deviceName.trim() : saved?.deviceName || "RANOA device";
  const hasConnectionInput = ["host", "port", "username", "password", "deviceName", "endpoint"].some((key) => key in body);
  if (endpoint && hasConnectionInput) {
    const profile: SyncConnectionProfile = { schemaVersion: 1, host, port, username, password, deviceName };
    await writeSyncConnection(agentDir, profile);
  }
  return { endpoint, auth: username && password ? { username, password } : undefined };
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
    return NextResponse.json(await responseWithConnection(agentDir, await readSyncState(agentDir), { device: safeDevice(await getLocalSyncDevice(agentDir)) }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read sync state" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const agentDir = getAgentDir();
  try {
    const body = await bodyOf(request);
    const action = typeof body.action === "string" ? body.action : "scan";
    const remote = action === "scan" || action === "workspace-mappings" || action === "save-workspace-mappings" ? { endpoint: "", auth: undefined } : await prepareConnection(agentDir, body);
    const endpoint = remote.endpoint;
    const auth = remote.auth;
    if (action === "scan") {
      const { manifest, summary } = await scanAgentData(agentDir);
      await writeLocalManifest(agentDir, manifest);
      const current = await readSyncState(agentDir);
      const next = { ...current, lastScan: summarizeScan(summary) };
      await writeSyncState(agentDir, next);
      return NextResponse.json(response(agentDir, next));
    }

    if (action === "create-vault") {
      const device = await createVault(endpoint, agentDir, typeof body.deviceName === "string" && body.deviceName ? body.deviceName : "RANOA device", auth);
      return NextResponse.json(response(agentDir, await readSyncState(agentDir), { device: safeDevice(device) }));
    }

    if (action === "pair-request") {
      const result = await requestPairing(endpoint, agentDir, requiredString(body, "code"), typeof body.deviceName === "string" && body.deviceName ? body.deviceName : "RANOA device", auth);
      const state = await readSyncState(agentDir);
      await writeSyncState(agentDir, { ...state, connection: { ...state.connection, status: "pairing", endpoint } });
      return NextResponse.json({ ...response(agentDir, await readSyncState(agentDir), { device: safeDevice(await getLocalSyncDevice(agentDir)) }), ...result, devicePublicKey: (await getLocalSyncDevice(agentDir))?.publicKey ?? null });
    }

    if (action === "pair-status") {
      const pairing = await pairingStatus(endpoint, requiredString(body, "requestId"), auth);
      if (pairing.status === "approved" && pairing.response) {
        const completed = await completePairing(endpoint, agentDir, pairing.response, typeof body.deviceName === "string" && body.deviceName ? body.deviceName : "RANOA device", auth);
        return NextResponse.json({ status: "approved", ...response(agentDir, await readSyncState(agentDir), { device: safeDevice(completed) }) });
      }
      return NextResponse.json({ status: pairing.status });
    }

    if (action === "pair-approve") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("This device is not paired as the vault owner");
      await approvePairing(endpoint, device, requiredString(body, "requestId"), requiredString(body, "newDevicePublicKey"), auth);
      return NextResponse.json({ status: "approved" });
    }

    if (action === "pair-complete") {
      const result = await completePairing(endpoint, agentDir, body.response as SyncAuthResponse, typeof body.deviceName === "string" && body.deviceName ? body.deviceName : "RANOA device", auth);
      return NextResponse.json(response(agentDir, await readSyncState(agentDir), { device: safeDevice(result) }));
    }

    if (action === "plan") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before creating a sync plan");
      return NextResponse.json(await syncPlan(endpoint, agentDir, device, auth));
    }

    if (action === "upload") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before uploading");
      const result = await uploadLocalChanges(endpoint, agentDir, device, auth);
      const state = await readSyncState(agentDir);
      await writeSyncState(agentDir, { ...state, connection: { ...state.connection, status: result.conflicts ? "conflict" : "connected", endpoint } });
      return NextResponse.json({ ...result, ...response(agentDir, await readSyncState(agentDir)) });
    }

    if (action === "download") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before downloading");
      const result = await downloadRemoteChanges(endpoint, agentDir, device, undefined, auth);
      const state = await readSyncState(agentDir);
      await writeSyncState(agentDir, { ...state, connection: { ...state.connection, status: "connected", endpoint } });
      return NextResponse.json({ ...result, ...response(agentDir, await readSyncState(agentDir)) });
    }

    if (action === "devices") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before listing devices");
      return NextResponse.json(await listSyncDevices(endpoint, device, auth));
    }

    if (action === "device-update") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before managing devices");
      await updateSyncDevice(endpoint, device, requiredString(body, "deviceId"), { action: body.deviceAction === "revoke" ? "revoke" : "update", name: typeof body.name === "string" ? body.name : undefined, role: body.role === "read_only" || body.role === "full" ? body.role : undefined }, auth);
      return NextResponse.json({ ok: true });
    }

    if (action === "conflicts") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before listing conflicts");
      return NextResponse.json(await listSyncConflicts(endpoint, device, auth));
    }

    if (action === "resolve-conflict") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before resolving conflicts");
      await resolveSyncConflict(endpoint, device, requiredString(body, "conflictId"), body.keepRevision === "local" ? "local" : "remote", auth);
      return NextResponse.json({ ok: true });
    }

    if (action === "snapshots") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before listing snapshots");
      return NextResponse.json(await listSyncSnapshots(endpoint, device, auth));
    }

    if (action === "restore-preview") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before previewing a restore");
      return NextResponse.json(await previewSyncRestore(endpoint, device, requiredString(body, "snapshotId"), auth));
    }

    if (action === "restore") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before restoring a snapshot");
      return NextResponse.json(await restoreSyncSnapshot(endpoint, device, requiredString(body, "snapshotId"), auth));
    }

    if (action === "audit") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before reading the audit log");
      return NextResponse.json(await listSyncAudit(endpoint, device, auth));
    }

    if (action === "rotate-epoch") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before rotating the server epoch");
      return NextResponse.json((await requestJson<{ serverEpoch: string }>(endpoint, "/v1/epoch/rotate", { method: "POST", body: JSON.stringify({}) }, device.deviceToken, auth)).value);
    }

    if (action === "workspace-mappings") return NextResponse.json({ mappings: await readWorkspaceMappings(agentDir) });

    if (action === "save-workspace-mappings") {
      if (!Array.isArray(body.mappings)) throw new Error("mappings must be an array");
      return NextResponse.json({ mappings: await writeWorkspaceMappings(agentDir, body.mappings as SyncWorkspaceMapping[]) });
    }

    if (action === "create-code") {
      const device = await getLocalSyncDevice(agentDir);
      if (!device?.deviceToken) throw new Error("Pair this device before creating a code");
      return NextResponse.json(await createPairingCode(endpoint, device, auth));
    }

    throw new Error(`Unknown sync action: ${action}`);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run sync action" }, { status });
  }
}
