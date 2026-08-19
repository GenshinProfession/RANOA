import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("uses a compact mobile toolbar with only naming and branch actions", () => {
  assert.match(source, /data-mobile-toolbar="true"[\s\S]*?flex: 1,[\s\S]*?minWidth: 0/);
  assert.match(
    source,
    /data-mobile-toolbar-actions="true"[\s\S]*?position: "absolute"[\s\S]*?right: 0,[\s\S]*?left: TOP_BAR_ICON_BUTTON_SIZE/,
  );

  for (const action of ["name", "branches"]) {
    assert.match(source, new RegExp(`data-mobile-toolbar-action=(?:\\{mobile \\? )?"${action}"`));
  }
  for (const action of ["history", "system", "language"]) {
    assert.doesNotMatch(source, new RegExp(`data-mobile-toolbar-action=(?:\\{mobile \\? )?"${action}"`));
  }
  assert.doesNotMatch(source, /data-mobile-toolbar-action=\{mobile \? "theme"/);
});

test("keeps covered statistics out of interaction and focus", () => {
  assert.match(source, /const covered = mobile && mobileToolbarMoreOpen;/);
  assert.match(source, /disabled=\{!showChat \|\| covered\}[\s\S]*?tabIndex=\{covered \? -1 : undefined\}/);
  assert.match(source, /aria-hidden=\{covered \? true : undefined\}/);
  assert.doesNotMatch(source, /data-mobile-toolbar-file/);
});

test("closes the mobile action layer on outside click, Escape, and session changes", () => {
  assert.match(source, /event\.composedPath\(\)\.includes\(toolbar\)/);
  assert.match(source, /document\.addEventListener\("pointerdown", handlePointerDown, true\)/);
  assert.match(source, /event\.key !== "Escape"[\s\S]*?setMobileToolbarMoreOpen\(false\)/);
  assert.match(source, /\}, \[isMobile, selectedSession\?\.id, newSessionDraftId\]\);/);
});

test("keeps the mobile action layer open after using an expanded action", () => {
  const toggleTopPanel = source.match(/const toggleTopPanel = useCallback\([\s\S]*?\n  \}, \[isMobile\]\);/)?.[0];
  const autoNameHandler = source.match(/onClick=\{\(\) => \{[\s\S]*?void handleAutoName\(\);[\s\S]*?\n              \}\}/)?.[0];

  for (const handler of [toggleTopPanel, autoNameHandler]) {
    assert.ok(handler);
    assert.doesNotMatch(handler, /setMobileToolbarMoreOpen\(false\)/);
    assert.match(handler, /setMobileToolbarMoreOpen\(true\)/);
  }

  assert.match(source, /toggleTopPanel\("branches", true\)/);
  assert.match(source, /onClick=\{\(\) => toggleTopPanel\("session"\)\}/);
});

test("prioritizes context and cost when the mobile statistics area narrows", () => {
  assert.match(source, /\.mobile-session-stats \{[\s\S]*?container-type: inline-size/);
  assert.match(source, /@container \(max-width: 158px\)[\s\S]*?\.mobile-session-stat-io/);
  assert.match(source, /@container \(max-width: 88px\)[\s\S]*?\.mobile-session-stat-cost/);
  assert.match(source, /mobileContextText = percent !== null \? `\$\{percent\.toFixed\(0\)\}%` : null/);
});

test("places trust warnings below the mobile toolbar without a manual file toggle", () => {
  assert.match(source, /\{isMobile && renderProjectTrustWarning\(true\)\}/);
  assert.match(source, /data-mobile-trust-banner=\{mobileBanner \? "true" : undefined\}/);
  assert.doesNotMatch(source, /File panel toggle — always visible at top-right/);
  assert.doesNotMatch(source, /renderMainFileToggle/);
  assert.doesNotMatch(source, /position: "fixed", top: "env\(safe-area-inset-top\)"/);
});
