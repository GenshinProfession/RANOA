import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useWallpaperTheme.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("ships three persistent adaptive wallpaper presets", () => {
  assert.match(source, /id: "roxy"/);
  assert.match(source, /id: "sylphiette"/);
  assert.match(source, /id: "eris"/);
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY, id\)/);
  assert.match(source, /document\.documentElement\.dataset\.wallpaper = id/);
});

test("uses a reduced-motion-safe view transition for wallpaper changes", () => {
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /document\.startViewTransition\(apply\)/);
  assert.match(source, /::view-transition-new\(root\)/);
});

test("gives each character a distinct surface, motif, and composer treatment", () => {
  assert.match(styles, /Roxy — celestial water magic/);
  assert.match(styles, /Sylphiette — moonlit greenhouse/);
  assert.match(styles, /Eris — ember steel/);
  assert.match(styles, /--character-composer-art:/);
  assert.match(styles, /html\[data-wallpaper="eris"\] \.chat-empty-launch-deck/);
  assert.match(styles, /--character-frame-image: url\("\/backgrounds\/roxy-arcane-frame\.png"\)/);
  assert.match(styles, /--character-frame-image: url\("\/backgrounds\/sylphiette-sanctuary-frame\.png"\)/);
  assert.match(styles, /--character-frame-image: url\("\/backgrounds\/eris-forge-frame\.png"\)/);
  assert.match(styles, /@keyframes character-frame-awaken/);
  assert.match(styles, /\.chat-empty-state \.chat-model-config-trigger/);
  assert.match(styles, /\.chat-empty-state \.chat-composer-shell \.chat-send-button/);
});
