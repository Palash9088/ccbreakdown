import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

export type PdfExtractErrorCode =
  | "PASSWORD_REQUIRED"
  | "PDF_READ_ERROR"
  | "PDF_EMPTY";

export type PdfExtractResult =
  | { ok: true; text: string }
  | { ok: false; error: PdfExtractErrorCode; message: string };

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let _pdfjs: PdfJsModule | null = null;

async function getPdfJs(): Promise<PdfJsModule> {
  if (_pdfjs) return _pdfjs;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  _pdfjs = pdfjs;
  return pdfjs;
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

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function extractPdfInBrowser(
  base64: string,
  password?: string
): Promise<PdfExtractResult> {
  const trimmedPassword = password?.trim();

  try {
    const pdfjs = await getPdfJs();
    const doc = await pdfjs
      .getDocument({
        data: base64ToUint8Array(base64),
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

    const text = parts.join("\n");
    if (!text || text.trim().length < 20) {
      return {
        ok: false,
        error: "PDF_EMPTY",
        message:
          "The PDF appears to have no readable text (it may be a scanned/image PDF). Please try a text-based statement.",
      };
    }

    return { ok: true, text };
  } catch (err: unknown) {
    if (isPdfPasswordError(err)) {
      return {
        ok: false,
        error: "PASSWORD_REQUIRED",
        message: trimmedPassword
          ? "Incorrect password. Please verify the credit card statement password and try again."
          : "This PDF is password-protected. Please enter the statement password.",
      };
    }
    return {
      ok: false,
      error: "PDF_READ_ERROR",
      message:
        "Could not read this PDF in your browser. Detail: " + errMessage(err),
    };
  }
}
