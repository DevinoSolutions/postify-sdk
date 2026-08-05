import type { Problem, ProblemCode, ProblemFieldError } from "./types.js";

/**
 * Typed error hierarchy (API D3/D9). Every non-2xx /v1 response is an RFC 9457
 * `application/problem+json` document; `APIError.code` carries its stable
 * machine-readable `code` — branch on that, never on `title`/`detail` text.
 *
 *   try { await postify.posts.create(...) }
 *   catch (err) {
 *     if (err instanceof RateLimitError && err.code === "rate_limited") ...
 *     if (err instanceof PermissionDeniedError) ...
 *   }
 */

/** Base class for every error the SDK throws. */
export class PostifyError extends Error {}

/** The request never produced an HTTP response (DNS, TLS, socket reset…). */
export class APIConnectionError extends PostifyError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "APIConnectionError";
  }
}

/** The per-attempt timeout elapsed before a response arrived. */
export class APITimeoutError extends APIConnectionError {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "APITimeoutError";
  }
}

/** The caller's own AbortSignal fired. Never retried. */
export class APIUserAbortError extends PostifyError {
  constructor() {
    super("Request was aborted by the caller's AbortSignal");
    this.name = "APIUserAbortError";
  }
}

/** A non-2xx HTTP response. Subclasses narrow by status family. */
export class APIError extends PostifyError {
  /** HTTP status code. */
  readonly status: number;
  /**
   * Stable machine-readable code from the problem document, or null when the
   * body was not parseable problem+json (e.g. an intermediary error page).
   * New codes may appear over time — treat unknown values as a generic error.
   */
  readonly code: ProblemCode | (string & {}) | null;
  /** Problem `type` URI (resolves to a docs page), when available. */
  readonly problemType: string | null;
  /** Occurrence-specific human explanation. Never parse it. */
  readonly detail: string | null;
  /** Field-level validation errors (`validation_failed` only). */
  readonly fieldErrors: ProblemFieldError[];
  /** The full problem document, when the body parsed as one. */
  readonly problem: Problem | null;
  /** Request correlation id — quote it in support requests. */
  readonly requestId: string | null;
  /** Response headers (rate-limit state, Retry-After, …). */
  readonly headers: Headers;
  /** Parsed `Retry-After` delay in seconds, when the server sent one. */
  readonly retryAfterSeconds: number | null;

  constructor(args: {
    status: number;
    problem: Problem | null;
    requestId: string | null;
    headers: Headers;
    retryAfterSeconds: number | null;
  }) {
    const summary = args.problem
      ? `${args.problem.title}${args.problem.detail ? ` — ${args.problem.detail}` : ""}`
      : "Non-2xx response without a problem+json body";
    super(
      `${args.status} ${args.problem?.code ?? "unknown"}: ${summary}` +
        (args.requestId ? ` (request_id: ${args.requestId})` : ""),
    );
    this.name = "APIError";
    this.status = args.status;
    this.problem = args.problem;
    this.code = args.problem?.code ?? null;
    this.problemType = args.problem?.type ?? null;
    this.detail = args.problem?.detail ?? null;
    this.fieldErrors = args.problem?.errors ?? [];
    this.requestId = args.requestId;
    this.headers = args.headers;
    this.retryAfterSeconds = args.retryAfterSeconds;
  }

  /** Build the status-appropriate subclass for a non-2xx response. */
  static fromResponse(args: {
    status: number;
    problem: Problem | null;
    requestId: string | null;
    headers: Headers;
    retryAfterSeconds: number | null;
  }): APIError {
    const cls =
      args.status === 400
        ? BadRequestError
        : args.status === 401
          ? AuthenticationError
          : args.status === 403
            ? PermissionDeniedError
            : args.status === 404
              ? NotFoundError
              : args.status === 409
                ? ConflictError
                : args.status === 422
                  ? UnprocessableEntityError
                  : args.status === 429
                    ? RateLimitError
                    : args.status >= 500
                      ? InternalServerError
                      : APIError;
    return new cls(args);
  }
}

export class BadRequestError extends APIError {}
export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class UnprocessableEntityError extends APIError {}
/**
 * 429 — check `code`: `rate_limited` (per-key burst; retry after
 * `retryAfterSeconds`) vs `quota_exhausted` (billing-period allowance;
 * retrying before the period resets is pointless).
 */
export class RateLimitError extends APIError {}
export class InternalServerError extends APIError {}

/** A webhook delivery failed Standard-Webhooks verification. */
export class WebhookVerificationError extends PostifyError {
  readonly reason:
    | "missing_headers"
    | "malformed_header"
    | "timestamp_out_of_tolerance"
    | "no_matching_signature";

  constructor(reason: WebhookVerificationError["reason"], message: string) {
    super(message);
    this.name = "WebhookVerificationError";
    this.reason = reason;
  }
}
