import "./ensurePdfNodeGlobals.js";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ensurePdfNodeGlobals } from "./ensurePdfNodeGlobals.js";
import { parseStatementFromText } from "./parseStatementText.js";
import type {
  ParseStatementInput,
  ParseStatementResult,
} from "./parseStatementTypes.js";

export type {
  ApiErrorBody,
  ParseStatementFailure,
  ParseStatementInput,
  ParseStatementResult,
  ParseStatementSuccess,
} from "./parseStatementTypes.js";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let _pdfjs: PdfJsModule | null = null;

async function getPdfJs(): Promise<PdfJsModule> {
  if (_pdfjs) return _pdfjs;
  await ensurePdfNodeGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(import.meta.url);
  try {
    const workerPath = require.resolve(
      "pdfjs-dist/legacy/build/pdf.worker.mjs"
    );
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  } catch {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.mjs`;
  }
  _pdfjs = pdfjs;
  return pdfjs;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isPdfPasswordError(err: unknown): boolean {
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  const msg = message.toLowerCase();
  const errName = name.toLowerCase();
  return (
    errName === "passwordexception" ||
    msg.includes("incorrect password") ||
    msg.includes("no password given") ||
    msg.includes("password") ||
    msg.includes("encrypted") ||
    msg.includes("decrypt") ||
    msg.includes("code: 4")
  );
}

async function extractPdfText(
  pdfBuffer: Buffer,
  password?: string
): Promise<string> {
  const pdfjs = await getPdfJs();
  const trimmedPassword = password?.trim();
  const doc = await pdfjs
    .getDocument({
      data: new Uint8Array(pdfBuffer),
      password: trimmedPassword || undefined,
      useSystemFonts: true,
      disableFontFace: true,
    })
    .promise;

  const parts: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageLines: string[] = [];
    for (const item of textContent.items) {
      if ("str" in item) {
        pageLines.push(item.str);
      }
    }
    parts.push(`--- Page ${pageNum} ---\n${pageLines.join(" ")}\n`);
  }
  return parts.join("\n");
}

/** Legacy server path: PDF + Gemini. Prefer browser extract + /api/parse-text on Vercel. */
export async function parseStatement(
  input: ParseStatementInput
): Promise<ParseStatementResult> {
  const { file, text, password, apiKey } = input;

  if (text?.trim()) {
    return parseStatementFromText({ text, apiKey });
  }

  if (!file) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "MISSING_FILE",
        message: "Please upload a valid PDF file.",
      },
    };
  }

  const pdfBuffer = Buffer.from(file, "base64");
  let extractedText = "";

  try {
    extractedText = await extractPdfText(pdfBuffer, password);
  } catch (err: unknown) {
    if (isPdfPasswordError(err)) {
      return {
        ok: false,
        status: 401,
        body: {
          error: "PASSWORD_REQUIRED",
          message: password
            ? "Incorrect password. Please verify the credit card statement password and try again."
            : "This PDF is password-protected. Please enter the statement password.",
        },
      };
    }
    console.error("PDF extraction error:", err);
    return {
      ok: false,
      status: 400,
      body: {
        error: "PDF_READ_ERROR",
        message:
          "Could not read this PDF. Please ensure it is a valid, non-corrupted PDF file. Detail: " +
          errMessage(err),
      },
    };
  }

  return parseStatementFromText({ text: extractedText, apiKey });
}
