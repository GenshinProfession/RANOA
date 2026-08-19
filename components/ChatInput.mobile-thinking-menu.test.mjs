import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("anchors the mobile reasoning menu to its left edge", () => {
  assert.match(
    source,
    /thinkingDropdownOpen[\s\S]*?bottom: "calc\(100% \+ 6px\)"[\s\S]*?isMobile \? \{ left: 0 \} : \{ right: 0 \}/,
  );
});

test("renders desktop configuration choices in a right-side cascade panel", () => {
  assert.match(source, /className=\{`chat-config-popover\$\{cascadeOpen \? " is-cascade"/);
  assert.match(source, /data-chat-config-detail="model"/);
  assert.match(source, /data-chat-config-detail="thinking"/);
  assert.match(source, /data-chat-config-detail="tools"/);
  assert.match(source, /viewportWidth >= panelWidth \+ detailWidth \+ cascadeGap \+ 32/);
});
