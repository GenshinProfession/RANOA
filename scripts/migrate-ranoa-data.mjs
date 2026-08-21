import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const userHome = homedir();
const ranoaRoot = join(userHome, ".ranoa");
const migrationId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const backupRoot = join(ranoaRoot, "migration-backups", migrationId);
const conflictRoot = join(ranoaRoot, "migration-conflicts", migrationId);

const sources = [
  { id: "pi-agent", source: join(userHome, ".pi", "agent"), target: join(ranoaRoot, "pi", "agent") },
  { id: "pi-sync", source: join(userHome, ".pi", ".ranoa-sync"), target: join(ranoaRoot, "pi", ".ranoa-sync") },
  { id: "legacy-pi-sync", source: join(userHome, ".pi", ".ranoa-sync"), target: join(ranoaRoot, "legacy", "pi", ".ranoa-sync") },
  { id: "legacy-harness", source: resolve(".pi-harness-dev"), target: join(ranoaRoot, "legacy", "pi-web", ".pi-harness-dev") },
  { id: "legacy-web-sync", source: resolve(".ranoa-sync"), target: join(ranoaRoot, "legacy", "pi-web", ".ranoa-sync") },
];

const totals = { copied: 0, updated: 0, unchanged: 0, destinationNewer: 0 };

async function sha256(path) {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

async function filesMatch(source, target, sourceStat, targetStat) {
  if (sourceStat.size !== targetStat.size) return false;
  return (await sha256(source)) === (await sha256(target));
}

async function copyWithParents(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function mergeDirectory(item, currentSource = item.source) {
  const entries = await readdir(currentSource, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(currentSource, entry.name);
    const relativePath = relative(item.source, sourcePath);
    const targetPath = join(item.target, relativePath);
    if (entry.isDirectory()) {
      await mergeDirectory(item, sourcePath);
      continue;
    }
    if (!entry.isFile()) continue;

    const sourceStat = await stat(sourcePath);
    if (!existsSync(targetPath)) {
      await copyWithParents(sourcePath, targetPath);
      totals.copied += 1;
      continue;
    }

    const targetStat = await stat(targetPath);
    if (await filesMatch(sourcePath, targetPath, sourceStat, targetStat)) {
      totals.unchanged += 1;
      continue;
    }

    // Keep the newest working copy, while archiving the losing side so the
    // migration is fully reversible and never discards divergent user data.
    if (sourceStat.mtimeMs >= targetStat.mtimeMs) {
      await copyWithParents(targetPath, join(backupRoot, item.id, relativePath));
      await copyWithParents(sourcePath, targetPath);
      totals.updated += 1;
    } else {
      await copyWithParents(sourcePath, join(conflictRoot, item.id, relativePath));
      totals.destinationNewer += 1;
    }
  }
}

await mkdir(ranoaRoot, { recursive: true });
const migratedSources = [];
for (const item of sources) {
  if (!existsSync(item.source)) continue;
  await mkdir(item.target, { recursive: true });
  await mergeDirectory(item);
  migratedSources.push({ source: item.source, target: item.target });
}

const manifestPath = join(ranoaRoot, "manifest.json");
let previous = {};
try { previous = JSON.parse(await readFile(manifestPath, "utf8")); } catch {}
await writeFile(manifestPath, JSON.stringify({
  schemaVersion: 2,
  managedBy: "ranoa",
  agentDir: join(ranoaRoot, "pi", "agent"),
  migratedAt: new Date().toISOString(),
  lastMigration: totals,
  sources: [...(previous.sources || []), ...migratedSources].filter((entry, index, all) => all.findIndex((candidate) => candidate.source === entry.source && candidate.target === entry.target) === index),
}, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  root: ranoaRoot,
  agentDir: join(ranoaRoot, "pi", "agent"),
  totals,
  backupCreated: totals.updated > 0 ? backupRoot : null,
  conflictsArchived: totals.destinationNewer > 0 ? conflictRoot : null,
}, null, 2));
