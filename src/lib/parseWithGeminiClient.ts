import {
  createGeminiClient,
  runGeminiStatementParse,
} from "../../lib/geminiStatementParse.js";
import type { ParseStatementResult } from "../../lib/parseStatementTypes.js";

/** Parse statement text with the user's API key directly from the browser (no Vercel). */
export async function parseStatementWithClientKey(
  text: string,
  apiKey: string
): Promise<ParseStatementResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "INVALID_API_KEY",
        message: "Enter your Gemini API key in the header to parse in the browser.",
      },
    };
  }

  if (!text || text.trim().length < 20) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "TEXT_EMPTY",
        message: "No statement text to parse.",
      },
    };
  }

  const ai = createGeminiClient(trimmedKey);
  return runGeminiStatementParse(ai, text);
}
