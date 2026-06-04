import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// ---------------------------------------------------------------------------
// Gemini client factory
// ---------------------------------------------------------------------------
let _aiClient: GoogleGenAI | null = null;

function getGeminiClient(customApiKey?: string): GoogleGenAI {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured on the server and no API key was provided by the client."
    );
  }

  // Always create a fresh client when the caller supplies their own key
  if (customApiKey) {
    return new GoogleGenAI({
      apiKey: customApiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
  }

  if (!_aiClient) {
    _aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
  }
  return _aiClient;
}

// ---------------------------------------------------------------------------
// PDF text extraction via pdf-parse (Node-native, no worker thread needed)
// ---------------------------------------------------------------------------
async function extractPdfText(
  pdfBuffer: Buffer,
  password?: string
): Promise<string> {
  // Import the parser implementation directly — the package entry runs debug code
  // on ESM dynamic import (!module.parent) and crashes on Vercel/serverless.
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;

  const options: Record<string, unknown> = {};
  if (password) {
    // pdf-parse passes options.password straight through to pdfjs internally
    options.password = password;
  }

  try {
    const data = await pdfParse(pdfBuffer, options);
    return data.text;
  } catch (err: any) {
    // Re-throw so the caller can detect password errors
    throw err;
  }
}

function isPdfPasswordError(err: any): boolean {
  const msg = (err?.message || "").toLowerCase();
  const name = (err?.name || "").toLowerCase();
  return (
    name === "passwordexception" ||
    msg.includes("password") ||
    msg.includes("encrypted") ||
    msg.includes("decrypt") ||
    msg.includes("code: 4")
  );
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

// Allow large base64-encoded PDF payloads (up to ~20 MB after encoding)
app.use(express.json({ limit: "25mb" }));

app.post(
  "/api/parse-statement",
  async (req: express.Request, res: express.Response) => {
    try {
      const { file, password, apiKey } = req.body;

      if (!file) {
        return res.status(400).json({
          error: "MISSING_FILE",
          message: "Please upload a valid PDF file.",
        });
      }

      // ---- Step 1: PDF → text ------------------------------------------------
      const pdfBuffer = Buffer.from(file, "base64");
      let extractedText = "";

      try {
        extractedText = await extractPdfText(pdfBuffer, password);
      } catch (err: any) {
        if (isPdfPasswordError(err)) {
          return res.status(401).json({
            error: "PASSWORD_REQUIRED",
            message: password
              ? "Incorrect password. Please verify the credit card statement password and try again."
              : "This PDF is password-protected. Please enter the statement password.",
          });
        }
        console.error("PDF extraction error:", err);
        return res.status(400).json({
          error: "PDF_READ_ERROR",
          message:
            "Could not read this PDF. Please ensure it is a valid, non-corrupted PDF file. Detail: " +
            (err.message || String(err)),
        });
      }

      if (!extractedText || extractedText.trim().length < 20) {
        return res.status(400).json({
          error: "PDF_EMPTY",
          message:
            "The PDF appears to have no readable text (it may be a scanned/image PDF). Please try a text-based statement.",
        });
      }

      // ---- Step 2: Gemini analysis -------------------------------------------
      let ai: GoogleGenAI;
      try {
        ai = getGeminiClient(apiKey);
      } catch (err: any) {
        return res.status(500).json({
          error: "CONFIG_ERROR",
          message: err.message,
        });
      }

      const systemInstruction = `Role: You are a specialized Financial Data Extraction Assistant. Your goal is to convert credit card statements (provided as raw extracted text) into structured, categorized expense reports.

Core Objectives:
1. Extract Transactions: Identify every transaction within the statement period, including dates, merchant names, listed categories, and amounts.
2. Standardize Data: Clean up merchant names (e.g., removing UPI handles like Q688... or transaction IDs, payment gateways, payment channel suffixes) to show the human-readable vendor name.
3. Categorize & Sub-categorize:
- Use the "Merchant Category" provided in the statement as the primary Category.
- Intelligently assign a Sub-Category based on the vendor name (e.g., if Category is "Dept Stores" and Vendor is "Myntra", Sub-Category should be "Online Shopping").
4. Handle Credits/Payments: Clearly distinguish between Debits (purchases/charges) and Credits (payments, statement credits, cashbacks, or refunds) using "CR" or negative signs as per the source document.
5. Extract Payment Due Date: Locate and extract the due date for payment. It is highly prioritized under the exact term "Due Date" or "Payment Due Date", "Please Pay By", "Pay By Date", etc. Note that in extracted text, the label "Due Date" may appear on a line immediately preceding the date value (e.g. "Due Date\\n04 Jun, 2026"). Match these values carefully.

Output Format:
Always present the data in two sections:
1. The Transaction Table:
A markdown table with the following headers:
Date | Vendor | Category | Sub-Category | Amount (Rs)
2. Summary Statistics:
A bulleted list below the table containing:
Total Payment Due: (The final bill amount)
Minimum Payment Due: (The minimum required)
Payment Due Date: (The date by which payment is due)
Total Purchases/Debits: (Sum of all spending)
Total Payments/Credits: (Sum of bill payments and refunds)
Top Spending Category: (Identify which category had the highest expenditure)
Key Insight: (e.g., Reward points earned or most frequent vendor)

Strict Guidelines:
- Extract all dates and amounts carefully to ensure absolute accuracy.
- Do not omit any transactions found in the statement.
- If the statement spans multiple pages, combine them into a single chronological table.
- Maintain the currency formatting (Rs. or ₹) as seen in the document.`;

      const prompt = `Here is the raw extracted text content from the credit card statement PDF:\n\n${extractedText}\n\nPlease parse the statement data and output the structured JSON response mapping strictly to our layout schema.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rawReport: {
                type: Type.STRING,
                description:
                  "The complete formatted markdown representation following the strict user guidelines, featuring 'The Transaction Table' and the 'Summary Statistics' bulleted list.",
              },
              transactions: {
                type: Type.ARRAY,
                description:
                  "Array of all credit card transactions found in the statement.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    date: {
                      type: Type.STRING,
                      description:
                        "Transaction date formatted as found, e.g. DD/MM/YYYY or DD MMM",
                    },
                    vendor: {
                      type: Type.STRING,
                      description:
                        "Standardized human-readable merchant name (e.g. Myntra)",
                    },
                    category: {
                      type: Type.STRING,
                      description:
                        "Primary Merchant Category from statement (e.g. Dept Stores)",
                    },
                    subCategory: {
                      type: Type.STRING,
                      description:
                        "Intelligently mapped sub-category (e.g. Online Shopping)",
                    },
                    amount: {
                      type: Type.STRING,
                      description:
                        "Formatted transaction amount with currency notation, including 'CR' or '-' if it is a credit payment.",
                    },
                    isCredit: {
                      type: Type.BOOLEAN,
                      description:
                        "True if this transaction represents a refund, payment credit, or cashback. False for standard debits/purchases.",
                    },
                  },
                  required: [
                    "date",
                    "vendor",
                    "category",
                    "subCategory",
                    "amount",
                    "isCredit",
                  ],
                },
              },
              summary: {
                type: Type.OBJECT,
                description:
                  "Summary totals extracted directly from the credit card statement.",
                properties: {
                  totalPaymentDue: {
                    type: Type.STRING,
                    description:
                      "The final total bill amount due (e.g. 'Rs. 12,450.00' or '₹12,450.00')",
                  },
                  minimumPaymentDue: {
                    type: Type.STRING,
                    description:
                      "The minimum amount required for payment (e.g. 'Rs. 620.00' or '₹620.00')",
                  },
                  paymentDueDate: {
                    type: Type.STRING,
                    description:
                      "The due date for payment listed in the statement under terms like 'Due Date', 'Payment Due Date', 'Please Pay By', 'Payment Date', 'Due On', or 'Pay By'.",
                  },
                  totalPurchases: {
                    type: Type.STRING,
                    description:
                      "Aggregated sum of all credit purchases/debits (e.g. '₹15,200.00')",
                  },
                  totalPayments: {
                    type: Type.STRING,
                    description:
                      "Aggregated sum of all bill payments and credits (e.g. '₹2,750.00')",
                  },
                  topSpendingCategory: {
                    type: Type.STRING,
                    description:
                      "Top category by absolute spending size",
                  },
                  keyInsight: {
                    type: Type.STRING,
                    description:
                      "Concise summary insight or reward point totals from statement review",
                  },
                },
                required: [
                  "totalPaymentDue",
                  "minimumPaymentDue",
                  "paymentDueDate",
                  "totalPurchases",
                  "totalPayments",
                  "topSpendingCategory",
                  "keyInsight",
                ],
              },
            },
            required: ["rawReport", "transactions", "summary"],
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("No response received from Gemini.");
      }

      const parsedJSON = JSON.parse(responseText);
      return res.json(parsedJSON);
    } catch (err: any) {
      console.error("Statement processing error:", err);
      return res.status(500).json({
        error: "INTERNAL_SERVICE_ERROR",
        message:
          "Unable to parse statement. Please ensure it is a valid credit card statement PDF. Details: " +
          (err.message || String(err)),
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Server startup (dev only — Vercel handles its own lifecycle)
// ---------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    // Lazy-import Vite only in development to avoid crashing in serverless
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
