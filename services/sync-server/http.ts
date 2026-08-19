import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { FileSyncStore, SyncStoreError, type SyncAuthContext } from "./store.ts";
import { PostgresSyncPersistence } from "./postgres.ts";
import type { VaultKeyEnvelope } from "../../lib/sync-crypto.ts";

const JSON_LIMIT = 32 * 1024 * 1024;
const CHUNK_LIMIT = 8 * 1024 * 1024;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    const chunk = Buffer.from(part as Uint8Array);
    size += chunk.length;
    if (size > limit) throw new SyncStoreError("body_too_large", "Request body is too large", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(request, JSON_LIMIT);
  if (!body.length) return {};
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
    return value as Record<string, unknown>;
  } catch {
    throw new SyncStoreError("invalid_json", "Request body must be a JSON object", 400);
  }
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new SyncStoreError("invalid_request", `${key} is required`, 400);
  return value;
}

function bearer(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new SyncStoreError("unauthorized", "Bearer device token required", 401);
  return header.slice("Bearer ".length).trim();
}

function pathParts(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
}

async function auth(store: FileSyncStore, request: IncomingMessage): Promise<SyncAuthContext> {
  return store.authenticate(bearer(request));
}

async function handle(store: FileSyncStore, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://ranoa.local");
  const parts = pathParts(url.pathname);
  if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
  if (request.method === "GET" && url.pathname === "/health") { sendJson(response, 200, { ok: true, protocol: 1, now: new Date().toISOString() }); return; }
  if (parts[0] !== "v1") throw new SyncStoreError("not_found", "Route not found", 404);

  if (request.method === "POST" && parts.length === 2 && parts[1] === "vaults") {
    const input = await readJson(request);
    const result = await store.createVault({ deviceId: requiredString(input, "deviceId"), deviceName: requiredString(input, "deviceName"), publicKey: requiredString(input, "publicKey"), vaultKeyEnvelope: input.vaultKeyEnvelope as VaultKeyEnvelope });
    sendJson(response, 201, result);
    return;
  }

  if (parts[1] === "pairing" && parts[2] === "codes" && request.method === "POST") {
    sendJson(response, 201, await store.createPairingCode(await auth(store, request)));
    return;
  }
  if (parts[1] === "pairing" && parts[2] === "requests" && parts.length === 3 && request.method === "POST") {
    const input = await readJson(request);
    sendJson(response, 201, await store.requestPairing({ code: requiredString(input, "code"), name: requiredString(input, "name"), publicKey: requiredString(input, "publicKey") }));
    return;
  }
  if (parts[1] === "pairing" && parts[2] === "requests" && parts.length === 4 && request.method === "GET") {
    sendJson(response, 200, await store.pairingStatus(parts[3]));
    return;
  }
  if (parts[1] === "pairing" && parts[2] === "requests" && parts.length === 5 && parts[4] === "approve" && request.method === "POST") {
    const input = await readJson(request);
    sendJson(response, 200, await store.approvePairing(await auth(store, request), parts[3], input.vaultKeyEnvelope as VaultKeyEnvelope));
    return;
  }

  if (parts[1] === "devices" && parts.length === 2 && request.method === "GET") {
    sendJson(response, 200, { devices: store.listDevices(await auth(store, request)) });
    return;
  }
  if (parts[1] === "devices" && parts.length === 3 && request.method === "PATCH") {
    const input = await readJson(request);
    if (input.action !== "revoke") throw new SyncStoreError("invalid_request", "Only revoke is supported", 400);
    await store.revokeDevice(await auth(store, request), parts[2]);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (parts[1] === "sync" && parts[2] === "plan" && request.method === "POST") {
    const input = await readJson(request);
    sendJson(response, 200, await store.plan(await auth(store, request), input as never));
    return;
  }
  if (parts[1] === "changes" && request.method === "GET") {
    const cursor = Number(url.searchParams.get("after") ?? "0");
    sendJson(response, 200, await store.changes(await auth(store, request), Number.isFinite(cursor) ? Math.max(0, cursor) : 0, Number(url.searchParams.get("limit") ?? "100")));
    return;
  }

  if (parts[1] === "chunks" && parts.length === 3 && (request.method === "HEAD" || request.method === "PUT")) {
    const context = await auth(store, request);
    if (request.method === "HEAD") {
      response.statusCode = await store.hasChunk(context.vault.vaultId, parts[2]) ? 200 : 404;
      response.end();
      return;
    }
    const body = await readBody(request, CHUNK_LIMIT);
    sendJson(response, 201, await store.putChunk(context.vault.vaultId, parts[2], body));
    return;
  }
  if (parts[1] === "chunks" && parts.length === 3 && request.method === "GET") {
    const context = await auth(store, request);
    const body = await store.getChunk(context.vault.vaultId, parts[2]);
    response.statusCode = 200;
    response.setHeader("content-type", "application/octet-stream");
    response.setHeader("cache-control", "no-store");
    response.end(body);
    return;
  }

  if (parts[1] === "objects" && parts.length === 4 && parts[3] === "commit" && request.method === "POST") {
    const input = await readJson(request);
    sendJson(response, 200, await store.commit(await auth(store, request), { ...input, objectId: parts[2] } as never));
    return;
  }

  if (parts[1] === "sessions" && parts.length === 4 && parts[3] === "lease") {
    const context = await auth(store, request);
    if (request.method === "POST") {
      const input = await readJson(request);
      sendJson(response, 200, await store.acquireLease(context, parts[2], requiredString(input, "runId"), typeof input.ttlMs === "number" ? input.ttlMs : undefined));
      return;
    }
    if (request.method === "DELETE") {
      await store.releaseLease(context, parts[2]);
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  if (parts[1] === "snapshots" && parts.length === 2 && request.method === "GET") {
    sendJson(response, 200, { snapshots: store.listSnapshots(await auth(store, request)) });
    return;
  }
  if (parts[1] === "snapshots" && parts.length === 2 && request.method === "POST") {
    const input = await readJson(request);
    sendJson(response, 201, await store.createSnapshot(await auth(store, request), typeof input.label === "string" && input.label ? input.label : "manual snapshot"));
    return;
  }

  if (parts[1] === "conflicts" && parts.length === 3 && parts[2] && request.method === "POST") {
    const input = await readJson(request);
    if (input.keepRevision !== "local" && input.keepRevision !== "remote") throw new SyncStoreError("invalid_request", "keepRevision must be local or remote", 400);
    await store.resolveConflict(await auth(store, request), parts[2], input.keepRevision);
    sendJson(response, 200, { ok: true });
    return;
  }

  throw new SyncStoreError("not_found", "Route not found", 404);
}

export interface SyncServerOptions {
  dataDir: string;
  databaseUrl?: string;
}

export async function createSyncServer(options: SyncServerOptions): Promise<{ server: Server; store: FileSyncStore }> {
  const persistence = options.databaseUrl ? new PostgresSyncPersistence(options.databaseUrl) : null;
  const store = new FileSyncStore(options.dataDir, persistence);
  await store.init();
  const server = createServer((request, response) => {
    handle(store, request, response).catch((error: unknown) => {
      if (error instanceof SyncStoreError) sendJson(response, error.status, { error: error.code, message: error.message, details: error.details });
      else sendJson(response, 500, { error: "internal_error", message: "Internal sync server error" });
    });
  });
  return { server, store };
}
