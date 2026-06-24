import "./ensurePdfNodeGlobals.js";
import { extractPdfTextFromBuffer } from "./extractPdfText.js";
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
    const { text } = await extractPdfTextFromBuffer(pdfBuffer, password);
    extractedText = text;
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
