import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { scanAgentData } from "@/lib/sync-scanner";
import { readSyncState, summarizeScan, writeLocalManifest, writeSyncState } from "@/lib/sync-state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const agentDir = getAgentDir();
    const state = await readSyncState(agentDir);
    return NextResponse.json({
      ...state,
      agentRootName: agentDir.split(/[\\/]/).pop() ?? "agent",
      phase: "local-preview",
      uploadEnabled: false,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read sync state" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { action?: string };
    if (body.action !== "scan") {
      return NextResponse.json({ error: "Only the local scan action is enabled in phase one." }, { status: 400 });
    }
    const agentDir = getAgentDir();
    const { manifest, summary } = await scanAgentData(agentDir);
    await writeLocalManifest(agentDir, manifest);
    const current = await readSyncState(agentDir);
    const next = { ...current, lastScan: summarizeScan(summary) };
    await writeSyncState(agentDir, next);
    return NextResponse.json({ ...next, agentRootName: agentDir.split(/[\\/]/).pop() ?? "agent", phase: "local-preview", uploadEnabled: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to scan local Pi data" }, { status: 500 });
  }
}
