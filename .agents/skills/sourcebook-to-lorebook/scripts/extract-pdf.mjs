#!/usr/bin/env node
// extract-pdf.mjs — extract text from a PDF and detect scanned/image-only PDFs.
// Usage: node extract-pdf.mjs <pdf-path> [--out <dir>]
// Run from the repo root so pdf-parse resolves from packages/server.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, basename, extname, resolve } from "node:path";

const require = createRequire(import.meta.url);

export function parseArgs(argv) {
  const args = argv.slice(2);
  const pdfPath = args.find((a) => !a.startsWith("--"));
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : null;
  if (!pdfPath) throw new Error("Usage: node extract-pdf.mjs <pdf-path> [--out <dir>]");
  return { pdfPath, outDir };
}

// Heuristic: detect scanned/image-only PDFs (which yield little extractable text).
// IMPORTANT: a *designed* PDF (cover art, full-page backgrounds, embedded fonts) has a
// LOW chars-per-KB ratio but healthy absolute text — it must NOT be flagged. So we lead
// with an absolute floor and only treat a low ratio as "scanned" when text is also sparse.
export function detectLikelyScanned(text, byteLength) {
  const nonWs = (text ?? "").replace(/\s+/g, "").length;
  if (nonWs < 500) return true; // near-blank -> almost certainly image-only
  const kb = Math.max(1, byteLength / 1024);
  return nonWs < 5000 && nonWs / kb < 2;
}

function loadPdfParse() {
  for (const base of [
    join(process.cwd(), "packages/server"),
    join(process.cwd(), "node_modules"),
    process.cwd(),
  ]) {
    try {
      return require(require.resolve("pdf-parse", { paths: [base] }));
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "Could not resolve 'pdf-parse'. Run from the repo root (it is a dependency of packages/server).",
  );
}

async function main() {
  const { pdfPath, outDir } = parseArgs(process.argv);
  const buf = await readFile(pdfPath);
  const { PDFParse } = loadPdfParse();
  const pdf = new PDFParse({ data: new Uint8Array(buf) });
  let text = "";
  try {
    const result = await pdf.getText();
    text = result?.text ?? "";
  } finally {
    await pdf.destroy?.();
  }

  if (detectLikelyScanned(text, buf.length)) {
    console.error(
      "ERROR: Extracted text is suspiciously short for this PDF — it is likely a scanned/image-only PDF. OCR is required (out of scope for this skill).",
    );
    process.exit(3);
  }

  const slug = basename(pdfPath, extname(pdfPath)).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const target = outDir ?? join(process.cwd(), ".tmp", `sourcebook-${slug}`);
  await mkdir(target, { recursive: true });
  const outPath = join(target, "extracted.txt");
  await writeFile(outPath, text, "utf-8");
  await writeFile(
    join(target, "extract.manifest.json"),
    JSON.stringify({ source: pdfPath, chars: text.length, outPath }, null, 2),
    "utf-8",
  );
  console.log(`OK: ${text.length} chars -> ${outPath}`);
}

// Only run main when invoked directly (not when imported by tests).
const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("ERROR:", err?.message ?? err);
    process.exit(1);
  });
}
