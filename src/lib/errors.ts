export type PipelineErrorCode =
  | "not_pdf"
  | "empty_file"
  | "file_too_large"
  | "extraction_failed"
  | "ai_auth"
  | "ai_unavailable"
  | "processing_failed";

/**
 * A failure with a stable, user-facing code. The UI localizes by code; the
 * `message` is the technical detail for logs.
 */
export class PipelineError extends Error {
  code: PipelineErrorCode;
  constructor(code: PipelineErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PipelineError";
    this.code = code;
  }
}

export function statusForCode(code: PipelineErrorCode): number {
  switch (code) {
    case "not_pdf":
    case "empty_file":
      return 400;
    case "file_too_large":
      return 413;
    case "extraction_failed":
      return 422;
    case "ai_auth":
    case "ai_unavailable":
      return 503;
    default:
      return 500;
  }
}

/** Classify an unknown error thrown while calling the LLM. */
export function classifyLlmError(err: unknown): PipelineError {
  if (err instanceof PipelineError) return err;
  const status =
    err && typeof err === "object" && "status" in err
      ? (err as { status?: number }).status
      : undefined;
  const message = err instanceof Error ? err.message : String(err);

  // Auth problems.
  if (status === 401 || status === 403 || /api[_ ]?key/i.test(message)) {
    return new PipelineError("ai_auth", message);
  }
  // Transient: rate limited / overloaded / server error / network.
  if (status === undefined || status === 429 || status >= 500) {
    return new PipelineError("ai_unavailable", message);
  }
  // Other 4xx (bad request, payload too large, …) is a bug on our side, not a
  // transient outage — don't tell the user to "try again in a moment".
  return new PipelineError("processing_failed", message);
}
