import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SettingsHub.tsx", import.meta.url), "utf8");

test("uses a primary settings tree with embedded configuration panes", () => {
  assert.match(source, /className="settings-hub-tree"/);
  assert.match(source, /id: "general"/);
  assert.match(source, /id: "appearance"/);
  assert.match(source, /id: "sync"/);
  assert.match(source, /id: "models"/);
  assert.match(source, /id: "skills"/);
  assert.match(source, /id: "plugins"/);
  assert.match(source, /<ModelsConfig embedded/);
  assert.match(source, /<SkillsConfig embedded/);
  assert.match(source, /<PluginsConfig embedded/);
  assert.match(source, /<AppearanceSettings/);
  assert.match(source, /<SyncSettings/);
});

test("offers only Chinese and English in the general settings pane", () => {
  assert.match(source, /className="settings-language-grid"/);
  assert.match(source, /plugin\.id === "zh-CN" \|\| plugin\.id === "en"/);
  assert.match(source, /setLocale\(plugin\.id as typeof locale\)/);
});

test("keeps workspace-scoped settings unavailable without a workspace", () => {
  assert.match(source, /id: "skills"[\s\S]*disabled: !cwd/);
  assert.match(source, /id: "plugins"[\s\S]*disabled: !cwd/);
  assert.match(source, /settings\.noWorkspace/);
});
