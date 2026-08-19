import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const inputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("renders the new-session composer as one continuous RANOA launch deck", () => {
  assert.match(source, /className="chat-empty-launch-deck/);
  assert.match(source, /className="chat-empty-hero"/);
  assert.match(source, /className="chat-empty-hero-axis"/);
  assert.doesNotMatch(source, /className="chat-empty-bridge"/);
  assert.match(source, /className="chat-empty-composer-frame"/);
  assert.match(source, /t\("empty\.title"\)/);
  assert.match(styles, /\.new-session-context-bar\s*\{[\s\S]*?margin:\s*-1px 0 0;/);
  assert.match(styles, /\.chat-empty-composer-frame > div\s*\{\s*padding:\s*0 !important;/);
  assert.match(styles, /\.chat-empty-hero-meta\s*\{[\s\S]*?position:\s*static;/);
});

test("fits the decorative shell to the deck and keeps controls interactive", () => {
  assert.match(source, /aria-labelledby="ranoa-launch-title"/);
  assert.match(inputSource, /className="chat-attach-button"/);
  assert.match(inputSource, /className="chat-model-config-trigger"/);
  assert.match(inputSource, /className="chat-sound-button"/);
  assert.match(inputSource, /className="chat-send-button"/);
  assert.match(styles, /\.chat-empty-launch-deck::after\s*\{[\s\S]*?inset:\s*-19px;/);
  assert.doesNotMatch(inputSource, /className="chat-input-root"/);
  assert.doesNotMatch(inputSource, /className="chat-input-column"/);
  assert.match(styles, /\.chat-empty-launch-deck::after\s*\{[\s\S]*?z-index:\s*1\s*!important;/);
  assert.match(styles, /\.chat-composer-tools \.chat-attach-button[\s\S]*?position:\s*static\s*!important;/);
  assert.match(styles, /\.chat-composer-tools \.chat-send-button[\s\S]*?position:\s*static\s*!important;/);
  assert.doesNotMatch(styles, /body \.chat-empty-state \.chat-composer-shell \.chat-composer-tools \.chat-attach-button[\s\S]*?position:\s*absolute\s*!important;/);
  assert.doesNotMatch(styles, /body \.chat-empty-state \.chat-composer-shell \.chat-composer-tools \.chat-send-button[\s\S]*?position:\s*absolute\s*!important;/);
  assert.match(styles, /--character-frame-image:\s*url\("\/backgrounds\/roxy-arcane-frame-controls-v2\.png"\)/);
  assert.match(styles, /--character-frame-image:\s*url\("\/backgrounds\/sylphiette-sanctuary-frame-controls-v2\.png"\)/);
  assert.match(styles, /--character-frame-image:\s*url\("\/backgrounds\/eris-forge-frame-controls-v2\.png"\)/);
  assert.match(styles, /--character-attach-art:\s*url\("\/ui\/controls\/roxy-attach\.png"\)/);
  assert.match(styles, /--character-model-art:\s*url\("\/ui\/controls\/sylphiette-model\.png"\)/);
  assert.match(styles, /--character-send-art:\s*url\("\/ui\/controls\/eris-send\.png"\)/);
  assert.match(styles, /\.chat-attach-button\s*\{[\s\S]*?var\(--character-attach-art\)/);
  assert.match(styles, /\.chat-model-config-trigger\s*\{[\s\S]*?var\(--character-model-art\)/);
  assert.match(styles, /\.chat-send-button\s*\{[\s\S]*?var\(--character-send-art\)/);
});
