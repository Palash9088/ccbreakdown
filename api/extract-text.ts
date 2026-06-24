import type { VercelRequest, VercelResponse } from "@vercel/node";
import { extractPdfText } from "../lib/extractPdfText.js";

export const maxDuration = 60;

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "METHOD_NOT_ALLOWED",
      message: "Only POST is supported.",
    });
  }

  try {
    const result = await extractPdfText(req.body ?? {});

    if (result.ok === false) {
      return res.status(result.status).json(result.body);
    }

    return res.status(200).json({
      text: result.text,
      pageCount: result.pageCount,
      charCount: result.charCount,
    });
  } catch (err: unknown) {
    console.error("Unhandled extract-text error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      error: "INTERNAL_SERVICE_ERROR",
      message: `Server error while extracting PDF text. Details: ${message}`,
    });
  }
}
