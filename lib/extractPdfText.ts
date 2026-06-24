import "./ensurePdfNodeGlobals.js";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ensurePdfNodeGlobals } from "./ensurePdfNodeGlobals.js";

export type PdfTextExtractInput = {
  file?: string;
  password?: string;
};

export type PdfTextExtractSuccess = {
  ok: true;
  text: string;
  pageCount: number;
  charCount: number;
};

export type PdfTextExtractFailure = {
  ok: false;
  status: number;
  body: {
    error: string;
    message: string;
  };
};

export type PdfTextExtractResult =
  | PdfTextExtractSuccess
  | PdfTextExtractFailure;

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

export async function extractPdfTextFromBuffer(
  pdfBuffer: Buffer,
  password?: string
): Promise<{ text: string; pageCount: number }> {
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

  return { text: parts.join("\n"), pageCount: doc.numPages };
}

/** Extract plain text from a base64 PDF — no AI. */
export async function extractPdfText(
  input: PdfTextExtractInput
): Promise<PdfTextExtractResult> {
  const { file, password } = input;

  if (!file?.trim()) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "MISSING_FILE",
        message: "Provide a PDF as base64 in the `file` field.",
      },
    };
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = Buffer.from(file, "base64");
  } catch {
    return {
      ok: false,
      status: 400,
      body: {
        error: "INVALID_FILE",
        message: "Could not decode base64 PDF data.",
      },
    };
  }

  if (pdfBuffer.length < 100) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "INVALID_FILE",
        message: "PDF data is too small to be a valid document.",
      },
    };
  }

  try {
    const { text, pageCount } = await extractPdfTextFromBuffer(
      pdfBuffer,
      password
    );

    if (!text.trim()) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "PDF_EMPTY",
          message:
            "No readable text found. The PDF may be scanned/image-only.",
        },
      };
    }

    return {
      ok: true,
      text,
      pageCount,
      charCount: text.length,
    };
  } catch (err: unknown) {
    if (isPdfPasswordError(err)) {
      return {
        ok: false,
        status: 401,
        body: {
          error: "PASSWORD_REQUIRED",
          message: password?.trim()
            ? "Incorrect password. Please verify and try again."
            : "This PDF is password-protected. Provide the `password` field.",
        },
      };
    }
    console.error("PDF text extraction error:", err);
    return {
      ok: false,
      status: 400,
      body: {
        error: "PDF_READ_ERROR",
        message:
          "Could not read this PDF. Detail: " + errMessage(err),
      },
    };
  }
}
