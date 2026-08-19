"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SyncCategorySummary, SyncScanSummary, SyncState } from "@/lib/sync-types";

interface SyncDevicePreview {
  deviceId: string;
  name: string;
  publicKey: string;
  vaultId: string | null;
  serverEpoch: string | null;
}

interface SyncResponse extends SyncState {
  agentRootName: string;
  phase: "local-preview" | "pairing" | "ready";
  uploadEnabled: boolean;
  device: SyncDevicePreview | null;
}

interface SyncPlan {
  serverEpoch: string;
  cursor: number;
  upload: string[];
  download: Array<{ objectId: string; currentRevision: number; deleted: boolean }>;
  conflicts: Array<{ conflictId: string; objectId: string; localRevision: number; remoteRevision: number }>;
  missingChunks: string[];
}

interface SyncActionResponse extends Partial<SyncResponse> {
  status?: string;
  requestId?: string;
  devicePublicKey?: string | null;
  code?: string;
  expiresAt?: string;
  uploaded?: number;
  downloaded?: number;
  deleted?: number;
  conflicts?: number;
  snapshotId?: string;
  error?: string;
}

const EMPTY_STATE: SyncResponse = {
  schemaVersion: 1,
  connection: { status: "disconnected", endpoint: null, vaultId: null, deviceId: null },
  lastScan: null,
  agentRootName: "agent",
  phase: "local-preview",
  uploadEnabled: false,
  device: null,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function categoryLabel(category: SyncCategorySummary["category"], t: (key: string) => string): string {
  return t(`sync.category.${category}`);
}

function shortId(value: string | null | undefined): string {
  return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "—";
}

export function SyncSettings() {
  const { t } = useI18n();
  const [state, setState] = useState<SyncResponse>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyAction, setBusyAction] = useState<"create" | "pair" | "approve" | "plan" | "upload" | "download" | "code" | null>(null);
  const [scanFeedback, setScanFeedback] = useState<"idle" | "complete">("idle");
  const [endpoint, setEndpoint] = useState("");
  const [deviceName, setDeviceName] = useState("RANOA device");
  const [pairCode, setPairCode] = useState("");
  const [requestId, setRequestId] = useState("");
  const [newDevicePublicKey, setNewDevicePublicKey] = useState("");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (scanFeedbackTimerRef.current) clearTimeout(scanFeedbackTimerRef.current);
  }, []);

  const applyState = useCallback((next: Partial<SyncResponse>) => {
    setState((current) => ({ ...current, ...next, connection: { ...current.connection, ...(next.connection ?? {}) } }));
    if (next.connection?.endpoint) setEndpoint(next.connection.endpoint);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const response = await fetch("/api/sync", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to read sync state");
      const next = await response.json() as SyncResponse;
      setState(next);
      if (next.connection.endpoint) setEndpoint(next.connection.endpoint);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to read sync state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadState(); }, [loadState]);

  const runAction = useCallback(async (action: string, payload: Record<string, unknown> = {}): Promise<SyncActionResponse> => {
    const response = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
    const result = await response.json() as SyncActionResponse;
    if (!response.ok) throw new Error(result.error ?? `Sync action failed: ${action}`);
    if (result.connection) applyState(result);
    return result;
  }, [applyState]);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanFeedback("idle");
    setError(null);
    try {
      const result = await runAction("scan");
      applyState(result);
      setScanFeedback("complete");
      if (scanFeedbackTimerRef.current) clearTimeout(scanFeedbackTimerRef.current);
      scanFeedbackTimerRef.current = setTimeout(() => setScanFeedback("idle"), 2200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to scan local Pi data");
    } finally {
      setScanning(false);
    }
  }, [applyState, runAction]);

  const withAction = useCallback(async (action: typeof busyAction, callback: () => Promise<void>) => {
    setBusyAction(action);
    setError(null);
    setActionFeedback(null);
    try { await callback(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("sync.actionFailed")); }
    finally { setBusyAction(null); }
  }, [t]);

  const createNewVault = () => void withAction("create", async () => {
    const result = await runAction("create-vault", { endpoint: endpoint.trim(), deviceName: deviceName.trim() || "RANOA device" });
    applyState(result);
    setActionFeedback(t("sync.vaultCreated"));
  });

  const submitPairRequest = () => void withAction("pair", async () => {
    const result = await runAction("pair-request", { endpoint: endpoint.trim(), code: pairCode.trim(), deviceName: deviceName.trim() || "RANOA device" });
    if (result.requestId) setRequestId(result.requestId);
    if (result.devicePublicKey) setNewDevicePublicKey(result.devicePublicKey);
    applyState(result);
    setActionFeedback(t("sync.pairingRequested"));
  });

  const checkPairing = () => void withAction("pair", async () => {
    const result = await runAction("pair-status", { endpoint: endpoint.trim(), requestId, deviceName: deviceName.trim() || "RANOA device" });
    if (result.status === "approved") { applyState(result); setRequestId(""); setActionFeedback(t("sync.pairingComplete")); }
    else setActionFeedback(t("sync.pairingWaiting"));
  });

  const approveDevice = () => void withAction("approve", async () => {
    await runAction("pair-approve", { endpoint: endpoint.trim(), requestId, newDevicePublicKey: newDevicePublicKey.trim() });
    setActionFeedback(t("sync.deviceApproved"));
  });

  const refreshPlan = () => void withAction("plan", async () => {
    const result = await runAction("plan", { endpoint: endpoint.trim() });
    setPlan(result as unknown as SyncPlan);
    setActionFeedback(t("sync.planReady"));
  });

  const upload = () => void withAction("upload", async () => {
    const result = await runAction("upload", { endpoint: endpoint.trim() });
    applyState(result);
    setPlan(null);
    setActionFeedback(t("sync.uploadComplete", { count: result.uploaded ?? 0 }));
  });

  const download = () => void withAction("download", async () => {
    const result = await runAction("download", { endpoint: endpoint.trim() });
    applyState(result);
    setPlan(null);
    setActionFeedback(t("sync.downloadComplete", { count: result.downloaded ?? 0 }));
  });

  const createCode = () => void withAction("code", async () => {
    const result = await runAction("create-code", { endpoint: endpoint.trim() });
    setGeneratedCode(result.code ?? null);
    setActionFeedback(t("sync.codeCreated"));
  });

  const copy = (value: string) => { void navigator.clipboard?.writeText(value); setActionFeedback(t("sync.copied")); };
  const scanSummary: SyncScanSummary | null = state.lastScan;
  const categoryRows = useMemo(() => scanSummary?.categories ?? [], [scanSummary]);
  const visualState = scanning ? "scanning" : scanFeedback === "complete" ? "complete" : state.connection.status;
  const connected = state.uploadEnabled;
  const journey = [
    { id: "inventory", label: t("sync.step.inventory"), state: scanning ? "active" : scanSummary ? "done" : "active" },
    { id: "encryption", label: t("sync.step.encryption"), state: connected ? "done" : "waiting" },
    { id: "ready", label: t("sync.step.ready"), state: plan || connected ? "active" : "waiting" },
  ] as const;

  return (
    <div className="sync-settings" data-sync-state={visualState}>
      <section className="sync-settings-hero">
        <div className="sync-settings-hero-mark" aria-hidden="true">
          <svg className="sync-settings-hero-svg" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 18.5a5.5 5.5 0 1 1 1.9-10.66A6.5 6.5 0 0 1 21 10.5a4 4 0 0 1-1 7.9H7Z" /><path d="M12 10v6M9.5 13.5h5" /></svg>
        </div>
        <div><span className="sync-settings-kicker">RANOA SYNC CENTER · PHASE 01</span><h3>{t("sync.title")}</h3><p>{t("sync.description")}</p></div>
        <span className="sync-settings-status" aria-live="polite"><i />{scanning ? t("sync.scanning") : scanFeedback === "complete" ? t("sync.scanComplete") : connected ? t("sync.connected") : t("sync.disconnected")}</span>
      </section>

      <section className="sync-settings-journey" aria-label={t("sync.progressTitle")}>
        <div className="sync-settings-journey-heading"><span>{t("sync.progressTitle")}</span><small>{t("sync.phaseLabel")}</small></div>
        <div className="sync-settings-journey-track"><span className="sync-settings-journey-line" aria-hidden="true" />{journey.map((step, index) => <div className={`sync-settings-step is-${step.state}`} key={step.id} style={{ "--sync-step": index } as CSSProperties}><span className="sync-settings-step-orb" aria-hidden="true">{step.state === "done" ? "✓" : index + 1}</span><span>{step.label}</span></div>)}</div>
      </section>

      <section className="sync-settings-connection">
        <div className="sync-settings-section-heading"><div><h3>{t("sync.connectionTitle")}</h3><p>{t("sync.connectionDescription")}</p></div><span className="sync-settings-phase-badge">{connected ? t("sync.connected") : t("sync.localPreview")}</span></div>
        <div className="sync-settings-connection-form">
          <label><span>{t("sync.endpoint")}</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:34141" spellCheck={false} /></label>
          <label><span>{t("sync.deviceName")}</span><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
        </div>
        <div className="sync-settings-connection-row">
          <div className="sync-settings-connection-copy"><span className={`sync-settings-signal${connected ? " is-connected" : ""}`} aria-hidden="true"><i /><i /><i /></span><div><strong>{connected ? t("sync.connectedToVault") : t("sync.notConnected")}</strong><small>{connected ? `${shortId(state.connection.vaultId)} · ${shortId(state.connection.deviceId)}` : t("sync.connectLater")}</small></div></div>
          <div className="sync-settings-inline-actions">
            {!connected && <><button type="button" className="sync-settings-secondary-button" onClick={createNewVault} disabled={loading || !endpoint.trim() || busyAction !== null}>{busyAction === "create" ? t("sync.working") : t("sync.createVault")}</button><button type="button" className="sync-settings-secondary-button" onClick={submitPairRequest} disabled={loading || !endpoint.trim() || !pairCode.trim() || busyAction !== null}>{busyAction === "pair" ? t("sync.working") : t("sync.joinWithCode")}</button></>}
            {connected && <button type="button" className="sync-settings-secondary-button" onClick={createCode} disabled={busyAction !== null || !endpoint.trim()}>{busyAction === "code" ? t("sync.working") : t("sync.createPairingCode")}</button>}
          </div>
        </div>
        {!connected && <div className="sync-settings-pair-code"><label><span>{t("sync.pairCode")}</span><input value={pairCode} onChange={(event) => setPairCode(event.target.value.toUpperCase())} placeholder={t("sync.pairCodePlaceholder")} maxLength={10} /></label><small>{t("sync.pairCodeHint")}</small></div>}
        {requestId && <div className="sync-settings-pairing-request"><div><strong>{t("sync.requestPending")}</strong><small>{shortId(requestId)}</small></div><button type="button" className="sync-settings-secondary-button" onClick={checkPairing} disabled={busyAction !== null}>{busyAction === "pair" ? t("sync.working") : t("sync.checkPairing")}</button><button type="button" className="sync-settings-text-button" onClick={() => copy(newDevicePublicKey)}>{t("sync.copyDeviceKey")}</button></div>}
        {connected && generatedCode && <div className="sync-settings-code-result"><span>{t("sync.pairingCode")}</span><code>{generatedCode}</code><button type="button" className="sync-settings-text-button" onClick={() => copy(generatedCode)}>{t("sync.copy")}</button></div>}
        {connected && <div className="sync-settings-approval"><div><strong>{t("sync.approveDevice")}</strong><small>{t("sync.approveDeviceHint")}</small></div><label><span>{t("sync.requestId")}</span><input value={requestId} onChange={(event) => setRequestId(event.target.value)} placeholder="pair_…" spellCheck={false} /></label><label><span>{t("sync.devicePublicKey")}</span><input value={newDevicePublicKey} onChange={(event) => setNewDevicePublicKey(event.target.value)} placeholder={t("sync.devicePublicKeyPlaceholder")} spellCheck={false} /></label><button type="button" className="sync-settings-secondary-button" onClick={approveDevice} disabled={busyAction !== null || !requestId.trim() || !newDevicePublicKey.trim()}>{busyAction === "approve" ? t("sync.working") : t("sync.approve")}</button></div>}
        {connected && <div className="sync-settings-device-meta"><span>{t("sync.deviceFingerprint")}</span><code>{shortId(state.device?.deviceId ?? state.connection.deviceId)}</code><span>{t("sync.epoch")}</span><code>{shortId(state.device?.serverEpoch)}</code></div>}
      </section>

      <section className="sync-settings-scan">
        <div className="sync-settings-section-heading"><div><h3>{t("sync.localInventory")}</h3><p>{t("sync.localInventoryDescription")}</p></div><div className="sync-settings-inline-actions"><button type="button" className="sync-settings-primary-button" onClick={() => void scan()} disabled={loading || scanning || busyAction !== null}><svg className={scanning ? "is-spinning" : ""} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 9" /><path d="M3 4v5h5M4 13a8.1 8.1 0 0 0 14.8 4L21 15" /><path d="M21 20v-5h-5" /></svg>{scanning ? t("sync.scanning") : t("sync.scanNow")}</button>{connected && <button type="button" className="sync-settings-secondary-button" onClick={refreshPlan} disabled={busyAction !== null || scanning}>{busyAction === "plan" ? t("sync.working") : t("sync.previewPlan")}</button>}</div></div>
        <div className="sync-settings-stats"><div style={{ "--sync-index": 0 } as CSSProperties}><small>{t("sync.files")}</small><strong>{scanSummary?.files ?? "—"}</strong></div><div style={{ "--sync-index": 1 } as CSSProperties}><small>{t("sync.size")}</small><strong>{scanSummary ? formatBytes(scanSummary.bytes) : "—"}</strong></div><div style={{ "--sync-index": 2 } as CSSProperties}><small>{t("sync.lastScan")}</small><strong>{scanSummary ? new Date(scanSummary.scannedAt ?? "").toLocaleTimeString() : t("sync.notScanned")}</strong></div></div>
        {categoryRows.length > 0 && <div className="sync-settings-category-grid">{categoryRows.map((row, index) => <div className="sync-settings-category" key={row.category} style={{ "--sync-index": index } as CSSProperties}><span className="sync-settings-category-icon" aria-hidden="true" /><div><strong>{categoryLabel(row.category, t)}</strong><small>{row.files} {t("sync.filesUnit")} · {formatBytes(row.bytes)}</small></div><span className="sync-settings-category-check">✓</span></div>)}</div>}
        {plan && <div className="sync-settings-plan"><div className="sync-settings-plan-heading"><div><strong>{t("sync.planTitle")}</strong><small>{t("sync.planDescription")}</small></div><span>{t("sync.cursor")} {plan.cursor}</span></div><div className="sync-settings-plan-grid"><div><strong>{plan.upload.length}</strong><small>{t("sync.toUpload")}</small></div><div><strong>{plan.download.length}</strong><small>{t("sync.toDownload")}</small></div><div><strong>{plan.conflicts.length}</strong><small>{t("sync.conflicts")}</small></div><div><strong>{plan.missingChunks.length}</strong><small>{t("sync.missingChunks")}</small></div></div><div className="sync-settings-plan-actions"><button type="button" className="sync-settings-primary-button" onClick={upload} disabled={busyAction !== null || plan.conflicts.length > 0}>{busyAction === "upload" ? t("sync.working") : t("sync.uploadChanges")}</button><button type="button" className="sync-settings-secondary-button" onClick={download} disabled={busyAction !== null || plan.conflicts.length > 0}>{busyAction === "download" ? t("sync.working") : t("sync.downloadChanges")}</button></div>{plan.conflicts.length > 0 && <p className="sync-settings-plan-warning">{t("sync.planConflictWarning", { count: plan.conflicts.length })}</p>}</div>}
        {scanSummary && <details className="sync-settings-excluded"><summary><span>{t("sync.excludedTitle", { count: scanSummary.skipped.length })}</span><span className="sync-settings-details-chevron">⌄</span></summary><div className="sync-settings-excluded-list">{scanSummary.skipped.map((item) => <span key={item.path}><code>{item.path}</code><small>{t(`sync.excludedReason.${item.reason}`)}</small></span>)}</div></details>}
      </section>

      <section className="sync-settings-safety"><span className="sync-settings-safety-icon" aria-hidden="true">✦</span><div><strong>{t("sync.safetyTitle")}</strong><small>{t("sync.safetyDescription")}</small></div><span className="sync-settings-lock">{connected ? t("sync.encryptedTransport") : t("sync.uploadDisabled")}</span></section>
      {actionFeedback && <p className="sync-settings-feedback" role="status">✦ {actionFeedback}</p>}
      {error && <p className="sync-settings-error" role="alert">{error}</p>}
      {scanSummary && <p className="sync-settings-hash">{t("sync.manifestFingerprint")}: <code>{scanSummary.manifestSha256?.slice(0, 20)}…</code></p>}
    </div>
  );
}
