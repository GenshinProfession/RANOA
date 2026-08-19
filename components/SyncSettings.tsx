"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SyncCategorySummary, SyncScanSummary, SyncState } from "@/lib/sync-types";

interface SyncResponse extends SyncState {
  agentRootName: string;
  phase: "local-preview";
  uploadEnabled: false;
}

const EMPTY_STATE: SyncResponse = {
  schemaVersion: 1,
  connection: { status: "disconnected", endpoint: null, vaultId: null, deviceId: null },
  lastScan: null,
  agentRootName: "agent",
  phase: "local-preview",
  uploadEnabled: false,
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

export function SyncSettings() {
  const { t } = useI18n();
  const [state, setState] = useState<SyncResponse>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<"idle" | "complete">("idle");
  const [error, setError] = useState<string | null>(null);
  const scanFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (scanFeedbackTimerRef.current) clearTimeout(scanFeedbackTimerRef.current);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const response = await fetch("/api/sync", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to read sync state");
      setState(await response.json() as SyncResponse);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to read sync state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadState(); }, [loadState]);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanFeedback("idle");
    setError(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });
      const payload = await response.json() as SyncResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to scan local Pi data");
      setState(payload);
      setScanFeedback("complete");
      if (scanFeedbackTimerRef.current) clearTimeout(scanFeedbackTimerRef.current);
      scanFeedbackTimerRef.current = setTimeout(() => setScanFeedback("idle"), 2200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to scan local Pi data");
    } finally {
      setScanning(false);
    }
  }, []);

  const scanSummary: SyncScanSummary | null = state.lastScan;
  const categoryRows = useMemo(() => scanSummary?.categories ?? [], [scanSummary]);
  const visualState = scanning ? "scanning" : scanFeedback === "complete" ? "complete" : state.connection.status;
  const journey = [
    { id: "inventory", label: t("sync.step.inventory"), state: scanning ? "active" : scanSummary ? "done" : "active" },
    { id: "encryption", label: t("sync.step.encryption"), state: "waiting" },
    { id: "ready", label: t("sync.step.ready"), state: "waiting" },
  ] as const;

  return (
    <div className="sync-settings" data-sync-state={visualState}>
      <section className="sync-settings-hero">
        <div className="sync-settings-hero-mark" aria-hidden="true">
          <svg className="sync-settings-hero-svg" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 18.5a5.5 5.5 0 1 1 1.9-10.66A6.5 6.5 0 0 1 21 10.5a4 4 0 0 1-1 7.9H7Z" />
            <path d="M12 10v6M9.5 13.5h5" />
          </svg>
        </div>
        <div>
          <span className="sync-settings-kicker">RANOA SYNC CENTER · PHASE 01</span>
          <h3>{t("sync.title")}</h3>
          <p>{t("sync.description")}</p>
        </div>
        <span className="sync-settings-status" aria-live="polite"><i />{scanning ? t("sync.scanning") : scanFeedback === "complete" ? t("sync.scanComplete") : t("sync.disconnected")}</span>
      </section>

      <section className="sync-settings-journey" aria-label={t("sync.progressTitle")}>
        <div className="sync-settings-journey-heading">
          <span>{t("sync.progressTitle")}</span>
          <small>{t("sync.phaseLabel")}</small>
        </div>
        <div className="sync-settings-journey-track">
          <span className="sync-settings-journey-line" aria-hidden="true" />
          {journey.map((step, index) => (
            <div className={`sync-settings-step is-${step.state}`} key={step.id} style={{ "--sync-step": index } as CSSProperties}>
              <span className="sync-settings-step-orb" aria-hidden="true">{step.state === "done" ? "✓" : index + 1}</span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="sync-settings-connection">
        <div className="sync-settings-section-heading">
          <div>
            <h3>{t("sync.connectionTitle")}</h3>
            <p>{t("sync.connectionDescription")}</p>
          </div>
          <span className="sync-settings-phase-badge">{t("sync.localPreview")}</span>
        </div>
        <div className="sync-settings-connection-row">
          <div className="sync-settings-connection-copy">
            <span className="sync-settings-signal" aria-hidden="true"><i /><i /><i /></span>
            <div><strong>{t("sync.notConnected")}</strong><small>{t("sync.connectLater")}</small></div>
          </div>
          <button type="button" className="sync-settings-secondary-button" disabled>{t("sync.pairDevice")}</button>
        </div>
      </section>

      <section className="sync-settings-scan">
        <div className="sync-settings-section-heading">
          <div>
            <h3>{t("sync.localInventory")}</h3>
            <p>{t("sync.localInventoryDescription")}</p>
          </div>
          <button type="button" className="sync-settings-primary-button" onClick={() => void scan()} disabled={loading || scanning}>
            <svg className={scanning ? "is-spinning" : ""} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 9" /><path d="M3 4v5h5M4 13a8.1 8.1 0 0 0 14.8 4L21 15" /><path d="M21 20v-5h-5" /></svg>
            {scanning ? t("sync.scanning") : t("sync.scanNow")}
          </button>
        </div>
        <div className="sync-settings-stats">
          <div style={{ "--sync-index": 0 } as CSSProperties}><small>{t("sync.files")}</small><strong>{scanSummary?.files ?? "—"}</strong></div>
          <div style={{ "--sync-index": 1 } as CSSProperties}><small>{t("sync.size")}</small><strong>{scanSummary ? formatBytes(scanSummary.bytes) : "—"}</strong></div>
          <div style={{ "--sync-index": 2 } as CSSProperties}><small>{t("sync.lastScan")}</small><strong>{scanSummary ? new Date(scanSummary.scannedAt ?? "").toLocaleTimeString() : t("sync.notScanned")}</strong></div>
        </div>
        {categoryRows.length > 0 && (
          <div className="sync-settings-category-grid">
            {categoryRows.map((row, index) => (
              <div className="sync-settings-category" key={row.category} style={{ "--sync-index": index } as CSSProperties}>
                <span className="sync-settings-category-icon" aria-hidden="true" />
                <div><strong>{categoryLabel(row.category, t)}</strong><small>{row.files} {t("sync.filesUnit")} · {formatBytes(row.bytes)}</small></div>
                <span className="sync-settings-category-check">✓</span>
              </div>
            ))}
          </div>
        )}
        {scanSummary && (
          <details className="sync-settings-excluded">
            <summary><span>{t("sync.excludedTitle", { count: scanSummary.skipped.length })}</span><span className="sync-settings-details-chevron">⌄</span></summary>
            <div className="sync-settings-excluded-list">
              {scanSummary.skipped.map((item) => <span key={item.path}><code>{item.path}</code><small>{t(`sync.excludedReason.${item.reason}`)}</small></span>)}
            </div>
          </details>
        )}
      </section>

      <section className="sync-settings-safety">
        <span className="sync-settings-safety-icon" aria-hidden="true">✦</span>
        <div><strong>{t("sync.safetyTitle")}</strong><small>{t("sync.safetyDescription")}</small></div>
        <span className="sync-settings-lock">{t("sync.uploadDisabled")}</span>
      </section>

      {error && <p className="sync-settings-error" role="alert">{error}</p>}
      {scanSummary && <p className="sync-settings-hash">{t("sync.manifestFingerprint")}: <code>{scanSummary.manifestSha256?.slice(0, 20)}…</code></p>}
    </div>
  );
}
