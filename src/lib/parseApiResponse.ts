export type ApiErrorPayload = {
  error?: string;
  message?: string;
};

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
  const contentType = response.headers.get("content-type") ?? "";
  let data: Record<string, unknown> = {};

  if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new Error(
        "Server returned invalid JSON. Try again or check deployment logs."
      );
    }
  } else if (!response.ok) {
    throw new Error(
      rawText.trim() || `Server error (${response.status}). Check GEMINI_API_KEY.`
    );
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
