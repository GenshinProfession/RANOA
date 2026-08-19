import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("keeps desktop conversation actions out of the top-bar action strip", () => {
  assert.doesNotMatch(source, /renderChatToolbarActions\(false\)/);
  assert.match(source, /className="topbar-conversation-lockup"/);
  assert.match(source, /sessionActions=\{\(/);
});

test("keeps branch and system as adjacent session inspector tabs without full history", () => {
  assert.match(source, /sessionInspectorTab === "branch"/);
  assert.match(source, /sessionInspectorTab === "system"/);
  assert.match(source, /onClick=\{handleSystemPromptTabSelect\}/);
  assert.doesNotMatch(source, /handleViewFullHistory/);
});

test("keeps language selection out of the top bar", () => {
  assert.doesNotMatch(source, /renderLanguageButton/);
  assert.doesNotMatch(source, /activeTopPanel === "language"/);
});

test("shows session information only for a persisted conversation above chat content", () => {
  assert.match(source, /const renderSessionStatsButton = \(mobile: boolean\) => \{\s*if \(!selectedSession\) return null;/);
  assert.match(source, /className="app-shell-topbar"[\s\S]*?zIndex: 700/);
  assert.match(source, /top: "100%"[\s\S]*?zIndex: 800/);
});

test("keeps theme and manual file-panel toggles out of the top bar", () => {
  assert.doesNotMatch(source, /renderThemeButton/);
  assert.doesNotMatch(source, /renderMainFileToggle/);
  assert.doesNotMatch(source, /topbar-file-toggle/);
});

test("uses one desktop arcana banner and keeps versions out of the launch composer", async () => {
  const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(source, /className="app-shell-topbar-primary"/);
  assert.match(source, /className="app-shell-topbar-row app-shell-topbar-secondary"/);
  assert.match(source, /className="topbar-conversation-title"/);
  assert.match(source, /className="topbar-conversation-meta"/);
  assert.match(source, /className="topbar-version-cluster"/);
  assert.match(source, /NEXT_PUBLIC_APP_VERSION/);
  assert.match(source, /NEXT_PUBLIC_PI_VERSION/);
  assert.doesNotMatch(chatWindowSource, /chat-empty-version-stack/);
  assert.doesNotMatch(chatWindowSource, /NEXT_PUBLIC_APP_VERSION|NEXT_PUBLIC_PI_VERSION/);
});

test("collapses from the sidebar brand and reveals the sidebar from the header", () => {
  assert.match(source, /onCollapseSidebar=\{handleSidebarToggle\}/);
  assert.match(source, /!sidebarOpen && \([\s\S]*?className="topbar-sidebar-reveal"/);
  assert.doesNotMatch(source, /className="topbar-icon-button topbar-sidebar-toggle"/);
});

test("anchors top panels to the filtered top bar instead of viewport coordinates", () => {
  assert.match(source, /position: "absolute",\s*top: "100%"/);
  assert.match(source, /setTopPanelPos\(\{ top: topBarRect\.bottom, left: 0, width: topBarRect\.width \}\)/);
});

test("opens the unified settings hub from one bottom sidebar entry", () => {
  assert.match(source, /className="sidebar-settings-footer"/);
  assert.match(source, /setSettingsOpen\(true\)/);
  assert.match(source, /<SettingsHub/);
  assert.doesNotMatch(source, /className="sidebar-global-panel"/);
});
