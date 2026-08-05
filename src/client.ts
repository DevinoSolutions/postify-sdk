import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  PostifyError,
} from "./errors.js";
import { AnalyticsResource } from "./resources/analytics.js";
import { ChannelsResource } from "./resources/channels.js";
import { MediaResource } from "./resources/media.js";
import { PostsResource } from "./resources/posts.js";
import { UsageResource } from "./resources/usage.js";
import { WebhookEndpointsResource } from "./resources/webhook-endpoints.js";
import type { Problem } from "./types.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://app.usepostify.com";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
/** Longest single retry sleep the client will honor from `Retry-After`. */
const MAX_RETRY_DELAY_MS = 60_000;

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type DebugLogger = (
  event: string,
  data: Record<string, unknown>,
) => void;

export interface ClientOptions {
  /** A Postify API key (`postify_live_…` / `postify_test_…`). Server-side only. */
  apiKey: string;
  /** API origin. Defaults to `https://app.usepostify.com`. */
  baseUrl?: string;
  /**
   * How to send the key: `"bearer"` → `Authorization: Bearer <key>` (default),
   * `"x-api-key"` → `x-api-key: <key>`. Both are accepted by the API.
   */
  authMethod?: "bearer" | "x-api-key";
  /** Per-attempt timeout in milliseconds. Default 30 000. */
  timeoutMs?: number;
  /**
   * Retries after the first attempt (default 2). Only GET requests and
   * mutations carrying an `Idempotency-Key` are ever retried.
   */
  maxRetries?: number;
  /**
   * Auto-generate an `Idempotency-Key` (UUID) on mutations that support it
   * (`posts.create`) when the caller didn't pass one, making their retries
   * safe. Default true.
   */
  autoIdempotencyKeys?: boolean;
  /** Custom fetch implementation (testing, instrumentation). */
  fetch?: typeof globalThis.fetch;
  /** Extra headers sent on every request. */
  defaultHeaders?: Record<string, string>;
  /**
   * `true` logs request/response/retry events to `console.debug`; pass a
   * function to receive them instead. Never logs headers, bodies, or the key
   * (the key appears only as a redacted fingerprint).
   */
  debug?: boolean | DebugLogger;
  /**
   * API keys are SECRETS — shipping one in a browser bundle exposes it to
   * every visitor. The client refuses to run in a browser unless this is set.
   */
  dangerouslyAllowBrowser?: boolean;
}

export interface RequestOptions {
  method: HttpMethod;
  /** Path relative to the base URL, e.g. `"/v1/posts"`. */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON-serializable request body. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Sent as the `Idempotency-Key` header; also unlocks retries on mutations. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  /** OperationId from the OpenAPI spec — used for debug logging. */
  op?: string;
}

/** Per-call options accepted by every resource method. */
export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
}

export interface ApiResult<T> {
  data: T;
  /** The raw Response (headers: rate-limit state, `Idempotency-Replayed`, …). */
  response: Response;
  /** The `Request-Id` correlation header. */
  requestId: string | null;
}

/** `postify_live_abc…xyz` → `postify_live_…wxyz` (prefix + last 4 only). */
export function redactApiKey(key: string): string {
  const prefixMatch = /^([a-z]+_(?:live|test)_)/.exec(key);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  return `${prefix}…${key.slice(-4)}`;
}

function parseRetryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get("Retry-After");
  if (raw == null) return null;
  const asInt = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;
  if (asInt != null) return asInt;
  const asDate = Date.parse(raw);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
}

/** Minimal structural check — the server contract, not a validation layer. */
function asProblem(body: unknown): Problem | null {
  if (typeof body !== "object" || body === null) return null;
  const p = body as Record<string, unknown>;
  if (typeof p.code !== "string" || typeof p.title !== "string") return null;
  if (typeof p.status !== "number") return null;
  return body as Problem;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new APIUserAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class Postify {
  readonly baseUrl: string;
  readonly posts: PostsResource;
  readonly channels: ChannelsResource;
  readonly media: MediaResource;
  readonly analytics: AnalyticsResource;
  readonly usage: UsageResource;
  readonly webhookEndpoints: WebhookEndpointsResource;

  readonly #apiKey: string;
  readonly #authMethod: "bearer" | "x-api-key";
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #autoIdempotencyKeys: boolean;
  readonly #fetch: typeof globalThis.fetch;
  readonly #defaultHeaders: Record<string, string>;
  readonly #debug: DebugLogger | null;

  constructor(options: ClientOptions) {
    if (!options?.apiKey) {
      throw new PostifyError(
        "Missing `apiKey`. Mint one in Settings → API keys (app.usepostify.com/settings/api-keys) and pass it as `new Postify({ apiKey })`.",
      );
    }
    if (
      typeof window !== "undefined" &&
      typeof (window as { document?: unknown }).document !== "undefined" &&
      options.dangerouslyAllowBrowser !== true
    ) {
      throw new PostifyError(
        "Refusing to run in a browser: a Postify API key is a secret and would be exposed to every visitor. Call the API from your server, or pass `dangerouslyAllowBrowser: true` if you truly know what you are doing.",
      );
    }
    this.#apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#authMethod = options.authMethod ?? "bearer";
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#autoIdempotencyKeys = options.autoIdempotencyKeys ?? true;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#defaultHeaders = options.defaultHeaders ?? {};
    this.#debug =
      options.debug === true
        ? (event, data) => console.debug(`[postify-sdk] ${event}`, data)
        : options.debug || null;
    this.#debug?.("client_initialized", {
      baseUrl: this.baseUrl,
      apiKey: redactApiKey(this.#apiKey),
      version: VERSION,
    });

    this.posts = new PostsResource(this);
    this.channels = new ChannelsResource(this);
    this.media = new MediaResource(this);
    this.analytics = new AnalyticsResource(this);
    this.usage = new UsageResource(this);
    this.webhookEndpoints = new WebhookEndpointsResource(this);
  }

  /** Whether the auto-idempotency default is enabled (used by `posts.create`). */
  get autoIdempotencyKeys(): boolean {
    return this.#autoIdempotencyKeys;
  }

  /**
   * Raw escape hatch: perform any /v1 request with the client's auth, retry,
   * and timeout machinery, and get the raw `Response` back alongside the
   * parsed body.
   */
  async request<T>(options: RequestOptions): Promise<ApiResult<T>> {
    const maxRetries = options.maxRetries ?? this.#maxRetries;
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const url = this.#buildUrl(options.path, options.query);
    const bodyText =
      options.body === undefined ? undefined : JSON.stringify(options.body);

    const headers = new Headers(this.#defaultHeaders);
    if (this.#authMethod === "bearer") {
      headers.set("Authorization", `Bearer ${this.#apiKey}`);
    } else {
      headers.set("x-api-key", this.#apiKey);
    }
    headers.set("Accept", "application/json");
    if (bodyText !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (options.idempotencyKey) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }
    const ua = `postify-sdk/${VERSION}${
      typeof process !== "undefined" && process.version
        ? ` node/${process.version}`
        : ""
    }`;
    headers.set("User-Agent", ua);
    headers.set("x-postify-sdk-version", VERSION);
    for (const [k, v] of Object.entries(options.headers ?? {})) {
      headers.set(k, v);
    }

    // Retry safety (D9): unsafe mutations are NEVER retried unless the caller
    // (or auto-generation) attached an Idempotency-Key.
    const retryable =
      options.method === "GET" || headers.has("Idempotency-Key");

    let attempt = 0;
    // oxlint-disable-next-line no-constant-condition
    while (true) {
      if (options.signal?.aborted) throw new APIUserAbortError();
      this.#debug?.("request", {
        op: options.op,
        method: options.method,
        url: url.toString(),
        attempt,
      });

      let response: Response;
      try {
        response = await this.#fetchWithTimeout(url, {
          method: options.method,
          headers,
          body: bodyText,
          signal: options.signal,
          timeoutMs,
        });
      } catch (err) {
        if (err instanceof APIUserAbortError) throw err;
        const connErr =
          err instanceof APIConnectionError
            ? err
            : new APIConnectionError(
                `Request failed to complete: ${String(err)}`,
                { cause: err },
              );
        if (retryable && attempt < maxRetries) {
          const delayMs = this.#backoffMs(attempt);
          this.#debug?.("retry", { attempt, delayMs, reason: connErr.name });
          await sleep(delayMs, options.signal);
          attempt += 1;
          continue;
        }
        throw connErr;
      }

      const requestId = response.headers.get("Request-Id");
      if (response.ok) {
        this.#debug?.("response", {
          op: options.op,
          status: response.status,
          requestId,
          attempt,
        });
        const data =
          response.status === 204
            ? (undefined as T)
            : await this.#parse<T>(response);
        return { data, response, requestId };
      }

      const rawBody: unknown = await response.json().catch(() => null);
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers);
      const problem = asProblem(rawBody);
      const apiError = APIError.fromResponse({
        status: response.status,
        problem,
        // Header first (authoritative); the problem body's request_id is the
        // fallback when an intermediary stripped the header.
        requestId: requestId ?? problem?.request_id ?? null,
        headers: response.headers,
        retryAfterSeconds,
      });
      this.#debug?.("response", {
        op: options.op,
        status: response.status,
        code: apiError.code,
        requestId,
        attempt,
      });

      if (retryable && attempt < maxRetries && this.#isRetryable(apiError)) {
        const delayMs = Math.min(
          apiError.retryAfterSeconds != null
            ? apiError.retryAfterSeconds * 1000
            : this.#backoffMs(attempt),
          MAX_RETRY_DELAY_MS,
        );
        this.#debug?.("retry", {
          attempt,
          delayMs,
          reason: `${apiError.status} ${apiError.code ?? "no_code"}`,
        });
        await sleep(delayMs, options.signal);
        attempt += 1;
        continue;
      }
      throw apiError;
    }
  }

  /**
   * Which HTTP failures are worth retrying:
   *  - 408 and any 5xx — transient by definition
   *  - 429 ONLY when it's the burst limiter (`rate_limited`, honors
   *    Retry-After). `quota_exhausted` is the billing-period allowance —
   *    retrying before the period resets can never succeed (D4).
   */
  #isRetryable(err: APIError): boolean {
    if (err.status === 408) return true;
    if (err.status >= 500) return true;
    if (err.status === 429) {
      if (err.code === "rate_limited") return true;
      return err.code === null && err.retryAfterSeconds != null;
    }
    return false;
  }

  #backoffMs(attempt: number): number {
    const base = Math.min(500 * 2 ** attempt, 8000);
    return base + Math.floor(Math.random() * base * 0.25);
  }

  async #parse<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch (err) {
      throw new PostifyError(
        `Expected a JSON response body but could not parse one (status ${response.status})`,
        { cause: err },
      );
    }
  }

  async #fetchWithTimeout(
    url: URL,
    init: {
      method: string;
      headers: Headers;
      body?: string;
      signal?: AbortSignal;
      timeoutMs: number;
    },
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, init.timeoutMs);
    const onUserAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onUserAbort, { once: true });
    try {
      return await this.#fetch(url.toString(), {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });
    } catch (err) {
      if (init.signal?.aborted) throw new APIUserAbortError();
      if (timedOut) throw new APITimeoutError(init.timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onUserAbort);
    }
  }

  #buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): URL {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url;
  }
}
