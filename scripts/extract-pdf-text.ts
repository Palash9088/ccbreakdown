#!/usr/bin/env npx tsx
/**
 * Extract plain text from a password-protected PDF (no AI).
 *
 * Usage:
 *   npx tsx scripts/extract-pdf-text.ts --pdf /path/to/file.pdf --password SECRET
 *   npx tsx scripts/extract-pdf-text.ts --pdf /path/to/file.pdf --password SECRET --out statement.txt
 */
import fs from "fs";
import path from "path";
import { extractPdfText } from "../lib/extractPdfText.js";

function usage(): never {
  console.error(`Usage: extract-pdf-text --pdf <path> [--password <pwd>] [--out <file.txt>]

Extracts readable text from a PDF using pdf.js. No Gemini or other AI.

Options:
  --pdf, -f       Path to the PDF file (required)
  --password, -p  PDF password if encrypted
  --out, -o       Write text to this file (default: stdout)
  --json          Print JSON { text, pageCount, charCount } instead of raw text
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let pdfPath = "";
  let password = "";
  let outPath = "";
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pdf" || arg === "-f") {
      pdfPath = argv[++i] ?? "";
    } else if (arg === "--password" || arg === "-p") {
      password = argv[++i] ?? "";
    } else if (arg === "--out" || arg === "-o") {
      outPath = argv[++i] ?? "";
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    }
  }

  if (!pdfPath) usage();
  return { pdfPath, password, outPath, json };
}

async function main() {
  const { pdfPath, password, outPath, json } = parseArgs(process.argv.slice(2));
  const resolved = path.resolve(pdfPath);

  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const base64 = fs.readFileSync(resolved).toString("base64");
  const result = await extractPdfText({ file: base64, password });

  if (result.ok === false) {
    console.error(`${result.body.error}: ${result.body.message}`);
    process.exit(result.status === 401 ? 2 : 1);
  }

  if (json) {
    const payload = JSON.stringify(
      {
        text: result.text,
        pageCount: result.pageCount,
        charCount: result.charCount,
      },
      null,
      2
    );
    if (outPath) {
      fs.writeFileSync(outPath, payload, "utf8");
      console.error(`Wrote JSON to ${path.resolve(outPath)}`);
    } else {
      console.log(payload);
    }
    return;
  }

  if (outPath) {
    fs.writeFileSync(outPath, result.text, "utf8");
    console.error(
      `Extracted ${result.charCount} chars from ${result.pageCount} page(s) → ${path.resolve(outPath)}`
    );
  } else {
    process.stdout.write(result.text);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
