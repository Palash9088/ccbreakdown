export type ApiErrorPayload = {
  error?: string;
  message?: string;
};

function parseJsonBody(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function vercelPlaintextMessage(rawText: string, status: number): string {
  const trimmed = rawText.trim();
  if (/^a server error has occurred/i.test(trimmed)) {
    return (
      "Vercel API failed to start (stale or broken deployment). " +
      "Redeploy the latest main from GitHub, or enter your Gemini API key above to parse in the browser."
    );
  }
  if (/function_invocation_failed|function_invocation_timeout/i.test(trimmed)) {
    return (
      "Vercel function crashed or timed out. Add a Gemini API key in the app header to parse in the browser, " +
      "or check deployment logs for /api/parse-text."
    );
  }
  return trimmed || `Server error (${status}). Check GEMINI_API_KEY on Vercel.`;
}

export async function fetchParseApi(
  url: string,
  body: Record<string, unknown>
): Promise<{
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  rawText: string;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  const data = parseJsonBody(rawText) ?? {};

  if (!response.ok && Object.keys(data).length === 0) {
    throw new Error(vercelPlaintextMessage(rawText, response.status));
  }

  if (response.ok && Object.keys(data).length === 0 && rawText.trim()) {
    throw new Error(vercelPlaintextMessage(rawText, response.status));
  }

  return { ok: response.ok, status: response.status, data, rawText };
}

export function getApiErrorMessage(
  status: number,
  data: ApiErrorPayload,
  filePassword?: string
): { handled: boolean; message: string; detail: string; passwordRequired?: boolean } | null {
  const apiError = data.error ?? "";
  const apiMessage = data.message ?? "";

  if (status === 401 && apiError === "PASSWORD_REQUIRED") {
    return {
      handled: true,
      passwordRequired: true,
      message: filePassword ? "Incorrect PDF Password" : "Password Required",
      detail:
        apiMessage ||
        (filePassword
          ? "The password you entered is incorrect. Please try again."
          : "This PDF is password-protected. Enter the password below."),
    };
  }

  if (apiError === "QUOTA_EXCEEDED" || apiError === "RATE_LIMIT") {
    return {
      handled: true,
      message: "Gemini API limit reached",
      detail:
        apiMessage ||
        "Quota exhausted for this model. Use gemini-flash-latest or enable billing in Google AI Studio.",
    };
  }

  if (apiError === "INVALID_API_KEY") {
    return {
      handled: true,
      message: "Invalid Gemini API key",
      detail:
        apiMessage ||
        "Check the key in the app header or set GEMINI_API_KEY on Vercel.",
    };
  }

  if (
    status === 504 ||
    apiError === "TIMEOUT" ||
    (apiMessage && /timeout|timed out|function_invocation_timeout/i.test(apiMessage))
  ) {
    return {
      handled: true,
      message: "Processing timed out",
      detail:
        apiMessage ||
        "Server timed out. Add your Gemini API key above to parse in the browser, or upgrade Vercel to Pro.",
    };
  }

  return null;
}
