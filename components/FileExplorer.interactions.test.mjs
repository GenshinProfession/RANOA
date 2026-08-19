import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("Shift+click mentions files and directories instead of opening them", () => {
  assert.match(source, /if \(event\.shiftKey && onAtMention\) \{\s*onAtMention\(getRelativeFilePath\(node\.fullPath, cwd\), node\.isDir\);\s*return;/);
  assert.match(source, /if \(event\.shiftKey && onAtMention\) \{\s*onAtMention\(rel, false\);\s*return;/);
  assert.match(source, /files\.shiftClickMention/);
});

test("directory rows accept dropped files and preserve the upload target", () => {
  assert.match(source, /onDragEnter=\{handleDirectoryDrag\}/);
  assert.match(source, /onDrop=\{handleDirectoryDrop\}/);
  assert.match(source, /onUploadDrop\(node\.fullPath, files\)/);
  assert.match(source, /uploadFiles\(targetDirectory, files, strategy, setUploadProgress\)/);
  assert.match(source, /targetDirectory,\s*files,\s*conflicts:/);
});

test("upload results highlight and mention files inside their destination directory", () => {
  assert.match(source, /joinFilePath\(targetDirectory, name\)/);
  assert.match(source, /joinFilePath\(uploadSummary\.targetDirectory, name\)/);
  assert.match(source, /files\.uploadedTo/);
});

test("blank explorer space remains a project-root drop target", () => {
  assert.match(source, /data-file-drop-root="true"/);
  assert.match(source, /prepareUpload\(files, cwd\)/);
  assert.match(source, /is-root-drop-target/);
});
