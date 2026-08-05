import { WebhookVerificationError } from "./errors.js";
import type { WebhookEvent } from "./types.js";

/**
 * Standard Webhooks v1 verification (https://www.standardwebhooks.com/),
 * mirroring the server's signer (apps/web `lib/webhooks/sign.ts` — the two
 * are cross-verified in the monorepo test suite):
 *
 *   webhook-id:        stable event id (identical across retries/replays)
 *   webhook-timestamp: unix seconds of THIS attempt
 *   webhook-signature: "v1,<base64>" — HMAC-SHA256 over
 *                      `${id}.${timestamp}.${rawBody}` keyed with the
 *                      base64-decoded bytes after `whsec_`. Multiple
 *                      space-separated signatures = rotation overlap.
 *
 * ALWAYS verify the RAW request bytes exactly as received — parsing and
 * re-serializing the JSON before verification breaks the signature.
 *
 * Uses WebCrypto (async), so it runs on Node ≥20, workers, and edge runtimes
 * without importing `node:crypto`.
 */

/** Default timestamp tolerance (seconds) — the Standard Webhooks 5-minute window. */
export const WEBHOOK_TOLERANCE_SEC = 300;

export interface VerifyWebhookArgs {
  /** The RAW request body, exactly as received. */
  payload: string;
  /** The delivery's request headers (a `Headers` or a plain object). */
  headers: Headers | Record<string, string | string[] | undefined>;
  /** The endpoint's signing secret (`whsec_…`), shown once at creation. */
  secret: string;
}

export interface VerifyWebhookOptions {
  /** Max clock skew in seconds (default 300). */
  toleranceSec?: number;
  /** Injected clock for tests. */
  now?: Date;
}

function headerValue(
  headers: VerifyWebhookArgs["headers"],
  name: string,
): string | null {
  if (headers instanceof Headers) return headers.get(name);
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) {
      if (v == null) return null;
      return Array.isArray(v) ? (v[0] ?? null) : v;
    }
  }
  return null;
}

/**
 * Base64-decode leniently (both standard and url-safe alphabets) — mirrors
 * Node's Buffer behavior the server relies on for grandfathered base64url
 * secrets.
 */
function base64Bytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.codePointAt(i)!;
  return bytes;
}

function secretBytes(secret: string): Uint8Array {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return base64Bytes(raw);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function hmacSha256(
  key: Uint8Array,
  message: string,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(signature);
}

/**
 * Verify a webhook delivery and return its parsed event envelope.
 * Throws `WebhookVerificationError` (with a machine-readable `reason`) when
 * headers are missing/malformed, the timestamp is outside tolerance, or no
 * signature matches.
 */
export async function verifyWebhook(
  args: VerifyWebhookArgs,
  options?: VerifyWebhookOptions,
): Promise<WebhookEvent> {
  const id = headerValue(args.headers, "webhook-id");
  const timestampRaw = headerValue(args.headers, "webhook-timestamp");
  const signatureHeader = headerValue(args.headers, "webhook-signature");
  if (!id || !timestampRaw || !signatureHeader) {
    throw new WebhookVerificationError(
      "missing_headers",
      "Missing webhook-id, webhook-timestamp, or webhook-signature header",
    );
  }

  if (!/^\d+$/.test(timestampRaw.trim())) {
    throw new WebhookVerificationError(
      "malformed_header",
      `webhook-timestamp is not a unix-seconds integer: "${timestampRaw}"`,
    );
  }
  const timestamp = Number(timestampRaw.trim());
  const toleranceSec = options?.toleranceSec ?? WEBHOOK_TOLERANCE_SEC;
  const nowSec = Math.floor((options?.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSec - timestamp) > toleranceSec) {
    throw new WebhookVerificationError(
      "timestamp_out_of_tolerance",
      `webhook-timestamp ${timestamp} is outside the ±${toleranceSec}s tolerance (now ${nowSec})`,
    );
  }

  const expected = await hmacSha256(
    secretBytes(args.secret),
    `${id}.${timestamp}.${args.payload}`,
  );
  const matches = signatureHeader
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .some((part) => {
      try {
        return constantTimeEqual(base64Bytes(part.slice(3)), expected);
      } catch {
        return false;
      }
    });
  if (!matches) {
    throw new WebhookVerificationError(
      "no_matching_signature",
      "No v1 signature in webhook-signature matches this payload and secret",
    );
  }

  return JSON.parse(args.payload) as WebhookEvent;
}
