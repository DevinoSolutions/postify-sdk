# @postify/sdk

Official TypeScript SDK for the [Postify](https://usepostify.com) public API — schedule and publish social posts across 10 platforms from your own code.

- **Docs:** https://app.usepostify.com/docs/api
- **API reference:** https://app.usepostify.com/docs/api-reference
- **Get an API key:** https://app.usepostify.com/settings/api-keys

## Install

```bash
npm install @postify/sdk
```

Node.js 18+ (uses the built-in `fetch` and WebCrypto). ESM.

## Quickstart

```ts
import { Postify } from "@postify/sdk";

const postify = new Postify({ apiKey: process.env.POSTIFY_API_KEY! });

// List your connected channels
const { data: channels } = await postify.channels.list();

// Create a scheduled post (an Idempotency-Key is generated automatically)
const post = await postify.posts.create({
  variants: [
    { channel_id: channels[0].id, body: "Hello from the Postify SDK!" },
  ],
  scheduled_at: "2026-08-01T09:00:00Z",
});

console.log(post.id, post.status);
```

This SDK is **server-side only** — an API key in a browser bundle is a leaked key. The constructor throws in browser-like environments unless you pass `dangerouslyAllowBrowser: true`.

## Errors

Every non-2xx response is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem parsed into a typed error. Branch on `code` (the stable machine-readable registry), never on `title`/`detail`:

```ts
import { APIError, RateLimitError } from "@postify/sdk";

try {
  await postify.posts.publish(post.id);
} catch (err) {
  if (err instanceof RateLimitError && err.code === "quota_exhausted") {
    // Monthly plan quota consumed — resets next billing period.
  } else if (err instanceof APIError) {
    console.error(err.status, err.code, err.detail, err.requestId);
  }
  throw err;
}
```

Hierarchy: `PostifyError` → `APIError` (`status`, `code`, `problemType`, `detail`, `fieldErrors`, `requestId`, `retryAfterSeconds`, raw `problem`) with per-status subclasses (`BadRequestError` 400, `AuthenticationError` 401, `PermissionDeniedError` 403, `NotFoundError` 404, `ConflictError` 409, `UnprocessableEntityError` 422, `RateLimitError` 429, `InternalServerError` 5xx), plus `APIConnectionError` / `APITimeoutError` / `APIUserAbortError` for transport failures. Include `requestId` when contacting support.

## Retries & idempotency

Failed requests (network errors, 408, 429, 5xx) retry automatically with exponential backoff, honoring the server's `Retry-After`. **Unsafe mutations are never retried without an idempotency key.** `posts.create` gets a UUID `Idempotency-Key` automatically (so it is safely retryable); pass your own to dedupe across processes:

```ts
await postify.posts.create(params, { idempotencyKey: "order-1234" });
```

Configure with `maxRetries` (default 2), `timeoutMs` (default 30 000), or per-call `signal` (AbortSignal). Disable auto keys with `autoIdempotencyKeys: false`.

## Pagination

List endpoints are async-iterable — iterate items and the SDK walks `next_cursor` for you:

```ts
for await (const post of postify.posts.list({ status: "scheduled" })) {
  console.log(post.id);
}
```

Or page manually:

```ts
const page = await postify.posts.list({ limit: 50 });
const next = await page.getNextPage(); // null on the last page
```

## Verifying webhooks

Postify signs outbound webhooks with [Standard Webhooks](https://www.standardwebhooks.com/). Verify the **raw request bytes** — parsing and re-serializing the JSON first will break the signature:

```ts
import { verifyWebhook, WebhookVerificationError } from "@postify/sdk";

// e.g. an Express route with `express.raw({ type: "application/json" })`
app.post("/postify-webhook", async (req, res) => {
  try {
    const event = await verifyWebhook({
      payload: req.body, // raw string or bytes
      headers: req.headers,
      secret: process.env.POSTIFY_WEBHOOK_SECRET!, // whsec_…
    });
    if (event.type === "post.published") {
      // handle it
    }
    res.status(200).end();
  } catch (err) {
    if (err instanceof WebhookVerificationError) return res.status(400).end();
    throw err;
  }
});
```

The verifier enforces the ±5-minute timestamp tolerance, uses constant-time comparison, and accepts rotation-overlap headers (multiple space-separated signatures).

## Escape hatches

```ts
// Raw request with full Response access
const { data, response, requestId } = await postify.request<{ id: string }>({
  method: "POST",
  path: "/v1/posts",
  body: { variants: [{ channel_id: "ch_…", body: "hi" }], draft: true },
  idempotencyKey: "abc",
});
response.headers.get("Idempotency-Replayed"); // "true" on a replay
```

Other options: `baseUrl` (self-hosted / testing), `authMethod: "x-api-key"` (instead of `Authorization: Bearer`), `defaultHeaders`, `fetch` (custom implementation), `debug` (structured logging — API keys are always redacted).

## Curl equivalence

Every SDK call maps 1:1 onto the documented REST surface:

```bash
curl https://app.usepostify.com/v1/posts \
  -H "Authorization: Bearer $POSTIFY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"variants":[{"channel_id":"ch_…","body":"Hello!"}],"scheduled_at":"2026-08-01T09:00:00Z"}'
```

is exactly `postify.posts.create(...)`.

## License

MIT
