/** Fast default — matches keys that work with gemini-flash-latest in AI Studio. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

/** Optional fallbacks when GEMINI_MODEL_FALLBACK=1 (slower; can cause Vercel timeouts). */
export const FALLBACK_GEMINI_MODELS = [
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
] as const;

export type GeminiErrorKind =
  | "quota"
  | "rate_limit"
  | "auth"
  | "model_not_found"
  | "unknown";

export type ParsedGeminiError = {
  kind: GeminiErrorKind;
  status?: number;
  retryAfterSeconds?: number;
  userMessage: string;
  rawMessage: string;
};

export function getGeminiModelCandidates(): string[] {
  const fromEnv = process.env.GEMINI_MODEL?.trim();
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
  }
  const useFallback =
    process.env.GEMINI_MODEL_FALLBACK === "1" ||
    process.env.GEMINI_MODEL_FALLBACK === "true";
  if (useFallback) {
    return [...FALLBACK_GEMINI_MODELS];
  }
  return [DEFAULT_GEMINI_MODEL];
}

function collectErrorText(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name} ${err.message} ${JSON.stringify(err)}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function parseRetrySeconds(text: string): number | undefined {
  const match = text.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  if (match) return Math.ceil(Number(match[1]));
  const delayMatch = text.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (delayMatch) return Number(delayMatch[1]);
  return undefined;
}

export function parseGeminiError(err: unknown): ParsedGeminiError {
  const raw = collectErrorText(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes("resource_exhausted") ||
    lower.includes("quota exceeded") ||
    lower.includes('"code":429') ||
    lower.includes("limit: 0")
  ) {
    return {
      kind: "quota",
      status: 429,
      retryAfterSeconds: parseRetrySeconds(raw),
      userMessage:
        "Gemini API quota is exhausted for this model on your API key. Try again later, enable billing in Google AI Studio, or set GEMINI_MODEL to a model you still have quota for (e.g. gemini-flash-latest).",
      rawMessage: raw,
    };
  }

  if (lower.includes("429") || lower.includes("rate limit")) {
    return {
      kind: "rate_limit",
      status: 429,
      retryAfterSeconds: parseRetrySeconds(raw) ?? 15,
      userMessage:
        "Gemini rate limit reached. Wait a moment and try again.",
      rawMessage: raw,
    };
  }

  if (
    lower.includes("api key not valid") ||
    lower.includes("invalid api key") ||
    lower.includes("permission_denied") ||
    lower.includes("unauthenticated") ||
    lower.includes('"code":401') ||
    lower.includes('"code":403')
  ) {
    return {
      kind: "auth",
      status: 401,
      userMessage:
        "Invalid or unauthorized Gemini API key. Check GEMINI_API_KEY on Vercel or enter a valid key in the app.",
      rawMessage: raw,
    };
  }

  if (
    lower.includes("not found") &&
    (lower.includes("model") || lower.includes("models/"))
  ) {
    return {
      kind: "model_not_found",
      status: 404,
      userMessage: "The configured Gemini model is not available for this API key.",
      rawMessage: raw,
    };
  }

  return {
    kind: "unknown",
    userMessage:
      "Gemini could not parse this statement. Check your API key, model quota, and try again.",
    rawMessage: raw,
  };
}

export function shouldTryNextGeminiModel(err: unknown): boolean {
  const parsed = parseGeminiError(err);
  // Same API key shares quota across models — retrying others causes timeouts.
  return parsed.kind === "model_not_found";
}

export function isFunctionTimeoutError(err: unknown): boolean {
  const text = collectErrorText(err).toLowerCase();
  return (
    text.includes("function_invocation_timeout") ||
    text.includes("invocation timeout") ||
    text.includes("task timed out")
  );
}

export function httpStatusForGeminiError(parsed: ParsedGeminiError): number {
  if (parsed.kind === "quota" || parsed.kind === "rate_limit") return 429;
  if (parsed.kind === "auth") return 401;
  if (parsed.kind === "model_not_found") return 400;
  return 500;
}

export function apiErrorCodeForGemini(parsed: ParsedGeminiError): string {
  switch (parsed.kind) {
    case "quota":
      return "QUOTA_EXCEEDED";
    case "rate_limit":
      return "RATE_LIMIT";
    case "auth":
      return "INVALID_API_KEY";
    case "model_not_found":
      return "MODEL_NOT_AVAILABLE";
    default:
      return "GEMINI_ERROR";
  }
}
