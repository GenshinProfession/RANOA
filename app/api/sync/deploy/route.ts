import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { deploySyncServer } from "@/lib/sync-deployer";
import { writeSyncConnection } from "@/lib/sync-connection";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const host = typeof body.host === "string" ? body.host.trim() : "";
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const sshPort = Number(body.sshPort) || 22;
    const syncPort = Number(body.syncPort) || 34141;
    const deviceName = typeof body.deviceName === "string" && body.deviceName.trim() ? body.deviceName.trim() : "RANOA device";
    const result = await deploySyncServer({ host, sshPort, username, password, syncPort }, process.cwd());
    await writeSyncConnection(getAgentDir(), { schemaVersion: 1, host: result.host, port: result.syncPort, username: result.username, password: result.password, deviceName });
    return NextResponse.json({ ok: true, deployment: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "部署同步服务器失败" }, { status: 400 });
  }
}
