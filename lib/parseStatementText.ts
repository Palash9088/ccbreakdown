import { getGeminiClient, runGeminiStatementParse } from "./geminiStatementParse.js";
import type { ParseStatementResult } from "./parseStatementTypes.js";

export type ParseStatementTextInput = {
  text?: string;
  apiKey?: string;
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function parseStatementFromText(
  input: ParseStatementTextInput
): Promise<ParseStatementResult> {
  const { text, apiKey } = input;

  if (!text || text.trim().length < 20) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "TEXT_EMPTY",
        message:
          "No statement text to parse. The PDF may be empty, scanned-only, or extraction failed.",
      },
    };
  }

  let ai;
  try {
    ai = getGeminiClient(apiKey);
  } catch (err: unknown) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "CONFIG_ERROR",
        message: errMessage(err),
      },
    };
  }

  return runGeminiStatementParse(ai, text);
}
