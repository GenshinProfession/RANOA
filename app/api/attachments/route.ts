import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { NextResponse } from "next/server";
import { allowFileRoot } from "@/lib/file-access";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { RANOA_ATTACHMENTS_DIR } from "@/lib/ranoa-paths";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 20;

function safeFileName(value: string): string {
  const name = basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return name || "attachment";
}

function uniqueFileName(value: string, usedNames: Set<string>): string {
  const safeName = safeFileName(value);
  const extension = extname(safeName);
  const stem = extension ? safeName.slice(0, -extension.length) : safeName;
  let candidate = safeName;
  let suffix = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${stem} (${suffix})${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

export async function POST(request: Request) {
  try {
    const form = await parseFormDataWithinLimit(request, MAX_REQUEST_BYTES);
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) return NextResponse.json({ error: "No files supplied" }, { status: 400 });
    if (files.length > MAX_FILES) return NextResponse.json({ error: `At most ${MAX_FILES} files can be imported at once` }, { status: 400 });
    const oversizedFile = files.find((file) => file.size > MAX_FILE_BYTES);
    if (oversizedFile) {
      return NextResponse.json({ error: `${oversizedFile.name} exceeds the 50 MB attachment limit` }, { status: 413 });
    }

    const date = new Date().toISOString().slice(0, 10);
    const batchDirectory = join(RANOA_ATTACHMENTS_DIR, date, randomUUID());
    await mkdir(batchDirectory, { recursive: true });
    allowFileRoot(RANOA_ATTACHMENTS_DIR);

    const paths: string[] = [];
    const usedNames = new Set<string>();
    for (const file of files) {
      const destination = join(batchDirectory, uniqueFileName(file.name, usedNames));
      await writeFile(destination, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
      paths.push(destination);
    }

    return NextResponse.json({ paths });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Attachment request exceeds 100 MB" }, { status: 413 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
