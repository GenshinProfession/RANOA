import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("manual and lifecycle refreshes bypass the server session-list cache", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /loadSessions\(isFirst, !isFirst\)/);
  assert.match(source, /const handleSessionRefresh = useCallback\(async \(\) => \{[\s\S]*?loadSessions\(false, true\)/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{hovered && !session\.transient && \(/);
});

test("session and explorer refreshes expose visible progress and completion states", () => {
  assert.match(source, /data-refresh-state=\{sessionRefreshing \? "refreshing" : sessionRefreshDone \? "complete" : "idle"\}/);
  assert.match(source, /className="refresh-feedback-icon"/);
  assert.match(source, /onRefreshSettled=\{handleExplorerRefreshSettled\}/);
  assert.match(source, /dataRefreshState=\{explorerRefreshing \? "refreshing" : explorerRefreshDone \? "complete" : "idle"\}/);
});

test("places new-session creation directly below the brand", () => {
  const brandIndex = source.indexOf('className="sidebar-brand-row"');
  const newSessionIndex = source.indexOf('className="sidebar-new-session sidebar-new-session-primary"');
  const workspaceIndex = source.indexOf('className="workspace-context-card"');
  const headerIndex = source.indexOf('className="session-list-header"');
  assert.ok(brandIndex >= 0 && brandIndex < newSessionIndex && newSessionIndex < workspaceIndex && workspaceIndex < headerIndex);
  assert.match(source, /className="sidebar-brand-edition">WORKBENCH/);
});

test("keeps conversation search and an accessible file divider in the quiet hierarchy", () => {
  assert.match(source, /className="sidebar-session-search"/);
  assert.match(source, /t\("sidebar\.searchSessions"\)/);
  assert.match(source, /className="file-explorer-divider-grip"/);
  assert.match(source, /onKeyDown=\{handleExplorerResizeKeyDown\}/);
  assert.match(source, /if \(event\.key === "ArrowUp"\) nextRatio = explorerRatio \+ 2/);
});

test("keeps the RANOA brand stable instead of swapping to version numbers", () => {
  const brandSource = source.slice(source.indexOf("function PiWebTitle"), source.indexOf("export function SessionSidebar"));
  assert.match(brandSource, /\{PRODUCT_NAME\}/);
  assert.doesNotMatch(brandSource, /showVersion|NEXT_PUBLIC_APP_VERSION|onClick/);
});

test("places sidebar collapse inside the branded workbench header", () => {
  assert.match(source, /onCollapseSidebar\?: \(\) => void/);
  assert.match(source, /className="sidebar-brand-lockup"/);
  assert.match(source, /className="sidebar-brand-collapse"/);
  assert.match(source, /onClick=\{onCollapseSidebar\}/);
});

test("marks session activity states for the refined visual hierarchy", () => {
  assert.match(sessionItemSource, /isSelected \? " is-selected"/);
  assert.match(sessionItemSource, /isRunning \? " is-running"/);
  assert.match(sessionItemSource, /isUnread \? " is-unread"/);
});
