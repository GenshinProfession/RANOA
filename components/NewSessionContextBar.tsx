"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";

type WorktreeEntry = {
  path: string;
  branch: string | null;
  isMain: boolean;
};

type WorktreeContext = {
  projectRoot: string;
  projectKey: string;
  isGit: boolean;
  isTopLevel: boolean;
  currentWorktreePath: string | null;
  worktrees: WorktreeEntry[];
};

type CwdChangeHandler = (
  cwd: string,
  projectRoot?: string | null,
  projectKey?: string | null,
) => void;

function useWorktreeContext(cwd: string | null) {
  const [context, setContext] = useState<WorktreeContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!cwd) {
      setContext(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as Partial<WorktreeContext> & { error?: string };
        if (!response.ok || data.error || !data.projectRoot) throw new Error(data.error || `HTTP ${response.status}`);
        setContext({
          projectRoot: data.projectRoot,
          projectKey: data.projectKey ?? data.projectRoot,
          isGit: data.isGit ?? false,
          isTopLevel: data.isTopLevel ?? false,
          currentWorktreePath: data.currentWorktreePath ?? null,
          worktrees: data.worktrees ?? [],
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setContext(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cwd, refreshKey]);

  return { context, loading, refresh: () => setRefreshKey((key) => key + 1) };
}

function BranchGlyph({ plus = false }: { plus?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="6" cy="19" r="2.2" />
      <path d="M6 7.2v9.6" />
      <path d="M8.2 12h4.3a5.5 5.5 0 0 0 5.5-5.5V5" />
      {plus && <path d="M18 14v6m-3-3h6" />}
    </svg>
  );
}

export function NewSessionContextBar({ cwd, onCwdChange }: { cwd: string | null; onCwdChange: CwdChangeHandler }) {
  const { t } = useI18n();
  const { context, loading, refresh } = useWorktreeContext(cwd);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setCreating(false);
      setBranchName("");
      setError(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    setOpen(false);
    setCreating(false);
    setBranchName("");
    setError(null);
  }, [cwd]);

  const current = useMemo(() => {
    if (!context) return null;
    return context.worktrees.find((worktree) => worktree.path === cwd)
      ?? context.worktrees.find((worktree) => worktree.path === context.currentWorktreePath)
      ?? context.worktrees.find((worktree) => worktree.isMain)
      ?? null;
  }, [context, cwd]);

  const choose = useCallback((worktree: WorktreeEntry) => {
    if (!context || worktree.path === cwd) {
      setOpen(false);
      return;
    }
    onCwdChange(worktree.path, context.projectRoot, context.projectKey);
    setOpen(false);
    setError(null);
  }, [context, cwd, onCwdChange]);

  const create = useCallback(async () => {
    const branch = branchName.trim();
    if (!context || !branch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: context.projectRoot, branch }),
      });
      const data = await response.json() as { path?: string; branch?: string; error?: string };
      if (!response.ok || !data.path) throw new Error(data.error || `HTTP ${response.status}`);
      refresh();
      onCwdChange(data.path, context.projectRoot, context.projectKey);
      setOpen(false);
      setCreating(false);
      setBranchName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [branchName, busy, context, onCwdChange, refresh]);

  const canChooseBranch = Boolean(context?.isGit && context.isTopLevel);
  const branchLabel = loading
    ? t("workspaceContext.checking")
    : current?.branch ?? (current?.isMain ? t("sidebar.main") : t("workspaceContext.noBranch"));

  return (
    <div className="new-session-context-bar" aria-label={t("workspaceContext.label")}>
      <div className="new-session-context-chip project" title={cwd ?? undefined}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
        </svg>
        <span>{cwd ? getFileName(context?.projectRoot ?? cwd) : t("workspaceContext.noProject")}</span>
      </div>
      <div className="new-session-context-chip runtime" title={t("workspaceContext.localTitle")}>
        <span className="new-session-runtime-dot" aria-hidden="true" />
        <span>{t("workspaceContext.local")}</span>
      </div>
      <div ref={rootRef} className="new-session-branch-control">
        <button
          type="button"
          className="new-session-context-chip branch"
          onClick={() => canChooseBranch && setOpen((value) => !value)}
          disabled={!canChooseBranch || loading}
          aria-expanded={open}
          aria-haspopup="menu"
          title={canChooseBranch ? t("workspaceContext.chooseBranch") : t("workspaceContext.branchUnavailable")}
        >
          <BranchGlyph />
          <span>{branchLabel}</span>
          {canChooseBranch && <svg className="new-session-context-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m2 3.5 3 3 3-3" /></svg>}
        </button>
        {open && context && (
          <div className="new-session-branch-menu" role="menu">
            <div className="new-session-branch-menu-head">
              <span>{t("workspaceContext.branchTitle")}</span>
              <small>{context.worktrees.length}</small>
            </div>
            <div className="new-session-branch-list">
              {context.worktrees.map((worktree) => {
                const active = worktree.path === current?.path;
                return (
                  <button key={worktree.path} type="button" role="menuitem" className={active ? "is-active" : ""} onClick={() => choose(worktree)} title={worktree.path}>
                    <BranchGlyph />
                    <span>{worktree.branch ?? getFileName(worktree.path)}</span>
                    {worktree.isMain && <small>{t("sidebar.main")}</small>}
                    {active && <i aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {!creating ? (
              <button
                type="button"
                className="new-session-create-branch"
                onClick={() => {
                  setCreating(true);
                  setError(null);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                <BranchGlyph plus />
                <span>{t("workspaceContext.createBranch")}</span>
              </button>
            ) : (
              <div className="new-session-branch-create-form">
                <input
                  ref={inputRef}
                  value={branchName}
                  onChange={(event) => { setBranchName(event.target.value); setError(null); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); void create(); }
                    if (event.key === "Escape") { setCreating(false); setBranchName(""); setError(null); }
                  }}
                  placeholder={t("sidebar.branchName")}
                />
                <button type="button" onClick={() => void create()} disabled={busy || !branchName.trim()}>{busy ? "…" : t("sidebar.create")}</button>
              </div>
            )}
            {error && <div className="new-session-branch-error">{error}</div>}
          </div>
        )}
      </div>
      <span className="new-session-context-hint">{t("workspaceContext.firstSessionOnly")}</span>
    </div>
  );
}

export function SessionBranchSummary({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const { context, loading } = useWorktreeContext(cwd);
  const current = context?.worktrees.find((worktree) => worktree.path === cwd)
    ?? context?.worktrees.find((worktree) => worktree.path === context.currentWorktreePath)
    ?? context?.worktrees.find((worktree) => worktree.isMain)
    ?? null;

  return (
    <div className="session-branch-summary">
      <div className="session-branch-summary-icon"><BranchGlyph /></div>
      <div className="session-branch-summary-copy">
        <span>{t("session.workBranch")}</span>
        <strong>{loading ? t("workspaceContext.checking") : current?.branch ?? t("workspaceContext.noBranch")}</strong>
        <p>{t("session.branchLocked")}</p>
      </div>
      <dl>
        <div><dt>{t("session.checkout")}</dt><dd title={cwd ?? undefined}>{cwd ?? "—"}</dd></div>
        <div><dt>{t("session.repository")}</dt><dd title={context?.projectRoot}>{context?.projectRoot ?? cwd ?? "—"}</dd></div>
        <div><dt>{t("session.branchKind")}</dt><dd>{current?.isMain ? t("session.mainCheckout") : t("session.worktreeCheckout")}</dd></div>
      </dl>
    </div>
  );
}
