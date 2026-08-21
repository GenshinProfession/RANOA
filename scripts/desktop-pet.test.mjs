import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("desktop/pet.html", root), "utf8");
const main = await readFile(new URL("desktop/main.cjs", root), "utf8");
const preload = await readFile(new URL("desktop/preload.cjs", root), "utf8");
const chatWindow = await readFile(new URL("components/ChatWindow.tsx", root), "utf8");

test("desktop companion ships a distinct generated character asset for every wallpaper", () => {
  assert.match(html, /roxy-companion\.png/);
  assert.match(html, /sylphiette-companion\.png/);
  assert.match(html, /eris-companion\.png/);
  assert.match(html, /data-theme="roxy"/);
  for (const theme of ["roxy", "sylphiette", "eris"]) {
    assert.match(html, new RegExp(`${theme}-working\\.png`));
    assert.match(html, new RegExp(`${theme}-thinking\\.png`));
    assert.match(html, new RegExp(`${theme}-tool\\.png`));
    assert.match(html, new RegExp(`${theme}-done\\.png`));
    assert.match(html, new RegExp(`${theme}-error\\.png`));
  }
});

test("desktop bridge synchronizes pet theme and runtime state", () => {
  assert.match(main, /ranoa:pet:set-theme/);
  assert.match(main, /currentPetTheme/);
  assert.match(preload, /setTheme/);
  assert.match(preload, /onTheme/);
  assert.match(html, /onTheme\(applyTheme\)/);
  assert.match(html, /onState\(setState\)/);
});

test("desktop companion follows the active task and uses character-specific names", () => {
  assert.match(main, /ranoa:pet:set-activity/);
  assert.match(main, /currentPetMessage = null/);
  assert.match(preload, /setActivity/);
  assert.match(preload, /onActivity/);
  assert.match(html, /onActivity\(receiveActivity\)/);
  assert.match(html, /洛琪希/);
  assert.match(html, /希露菲/);
  assert.match(html, /爱丽丝/);
  assert.doesNotMatch(html, /RANOA 伙伴/);
  assert.match(html, /renderBubbleContent/);
  assert.match(chatWindow, /getLastUserTaskText/);
  assert.match(chatWindow, /pet\.setActivity/);
});

test("desktop companion can be dragged without sacrificing click interactions", () => {
  assert.match(main, /ranoa:pet:drag-start/);
  assert.match(main, /ranoa:pet:drag-move/);
  assert.match(main, /screen\.getCursorScreenPoint/);
  assert.match(main, /originBounds\.x \+ cursor\.x - cursorX/);
  assert.match(preload, /startDrag/);
  assert.match(preload, /moveDrag/);
  assert.match(preload, /endDrag/);
  assert.match(html, /addEventListener\("pointerdown"/);
  assert.match(html, /dragThreshold = 7/);
  assert.match(html, /pet\.startDrag\(\{ x: session\.startX, y: session\.startY \}\)/);
  assert.match(html, /pet\.moveDrag\(\)/);
  assert.match(html, /suppressClickUntil/);
  assert.match(html, /setBubbleVisibility\(false, true\)/);
  assert.match(html, /body \{[^}]*-webkit-app-region: no-drag/);
  assert.doesNotMatch(html, /body \{[^}]*-webkit-app-region: drag/);
});

test("desktop companion sequences bubble resizing separately from its reveal animation", () => {
  assert.match(html, /await window\.ranoaDesktop\?\.pet\.setBubbleOpen\(true\)[\s\S]*?classList\.add\("bubble-open"\)/);
  assert.match(html, /classList\.remove\("bubble-open"\)[\s\S]*?pet\.setBubbleOpen\(false\)/);
  assert.match(html, /bubbleTransitionId/);
  assert.match(main, /setBounds\([\s\S]*?false\);/);
});

test("desktop companion presents completion summaries and sends replies back to the workbench", () => {
  assert.match(main, /ranoa:pet:present/);
  assert.match(main, /currentPetActivity = null/);
  assert.match(main, /ranoa:pet:reply/);
  assert.match(main, /mainWindow\.webContents\.send\("ranoa:pet:reply"/);
  assert.match(preload, /present: \(message\)/);
  assert.match(preload, /onMessage/);
  assert.match(preload, /onReply/);
  assert.match(html, /class="pet-bubble"/);
  assert.match(html, /onMessage\(receiveMessage\)/);
  assert.match(html, /pet\.reply/);
  assert.match(html, /renderMarkdown\(bubbleText, activeMessage\.text\)/);
  assert.match(html, /appendInlineMarkdown/);
  assert.match(main, /ranoa:pet:set-bubble-open/);
  assert.match(preload, /setBubbleOpen/);
});

test("desktop companion has polished and accessible motion states", () => {
  assert.match(html, /data-state="working"/);
  assert.match(html, /data-state="thinking"/);
  assert.match(html, /data-state="tool"/);
  assert.match(html, /companion-done/);
  assert.match(html, /companion-error/);
  assert.match(html, /prefers-reduced-motion: reduce/);
});

test("a second desktop launch restores the workbench while the companion is alive", () => {
  assert.match(main, /app\.on\("second-instance"/);
  assert.match(main, /if \(!mainWindow \|\| mainWindow\.isDestroyed\(\)\) \{\s*createMainWindow\(\)/);
  assert.match(main, /app\.on\("activate"[\s\S]*?if \(!mainWindow \|\| mainWindow\.isDestroyed\(\)\) createMainWindow\(\)/);
});

test("desktop chrome uses a skin-aware draggable title bar and functional application menu", () => {
  assert.match(main, /nativeTheme\.themeSource = "dark"/);
  assert.match(main, /frame: false/);
  assert.match(main, /thickFrame: true/);
  assert.match(main, /ranoa:menu:open/);
  assert.match(main, /ranoa:window:action/);
  assert.match(main, /label: "撤销"/);
  assert.match(preload, /menu:[\s\S]*?ranoa:menu:open/);
  assert.match(preload, /toggleMaximize/);
  assert.match(main, /mainWindow\.center\(\)/);
});

test("desktop companion keeps a compact footprint", () => {
  assert.match(main, /compactPetSize = \{ width: 220, height: 290 \}/);
  assert.match(main, /expandedPetSize = \{ width: 560, height: 330 \}/);
  assert.match(html, /right: -53px; bottom: 0; width: 326px; height: 426px/);
  assert.match(html, /scale: \.65/);
});
