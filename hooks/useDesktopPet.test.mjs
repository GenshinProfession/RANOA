import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useDesktopPet.ts", import.meta.url), "utf8");
const appearance = await readFile(new URL("../components/AppearanceSettings.tsx", import.meta.url), "utf8");

test("desktop companion preference persists and drives the native pet window", () => {
  assert.match(source, /ranoa-desktop-pet-enabled/);
  assert.match(source, /enabled \? pet\.show\(\) : pet\.hide\(\)/);
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY, String\(nextEnabled\)\)/);
});

test("appearance settings exposes the companion switch only in the desktop app", () => {
  assert.match(appearance, /desktopAvailable &&/);
  assert.match(appearance, /role="switch"/);
  assert.match(appearance, /setEnabled\(!enabled\)/);
});
