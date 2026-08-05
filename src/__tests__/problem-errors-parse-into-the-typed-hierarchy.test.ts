import { describe, expect, it } from "vitest";
import { Postify } from "../client.js";
import {
  APIError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "../errors.js";
import {
  jsonResponse,
  problemResponse,
  stubFetch,
} from "./helpers/fetch-stub.js";

function client(fetchImpl: typeof globalThis.fetch) {
  return new Postify({
    apiKey: "postify_test_errkey1234",
    fetch: fetchImpl,
    maxRetries: 0,
  });
}

describe("RFC 9457 problem responses parse into the typed error hierarchy", () => {
  it("maps statuses to subclasses and exposes code/type/detail/requestId", async () => {
    const { fetchImpl } = stubFetch([
      () =>
        problemResponse(403, "insufficient_scope", {
          detail: "This key lacks posts:write.",
        }),
    ]);
    const err = await client(fetchImpl)
      .posts.publish("post_1")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    const apiErr = err as PermissionDeniedError;
    expect(apiErr.status).toBe(403);
    expect(apiErr.code).toBe("insufficient_scope");
    expect(apiErr.problemType).toContain("/problems/insufficient-scope");
    expect(apiErr.detail).toBe("This key lacks posts:write.");
    expect(apiErr.requestId).toBe("req_test123");
    expect(apiErr.message).toContain("insufficient_scope");
    expect(apiErr.message).toContain("req_test123");
  });

  it("exposes field-level errors on validation_failed", async () => {
    const { fetchImpl } = stubFetch([
      () =>
        problemResponse(422, "idempotency_key_reused", {
          errors: [
            {
              pointer: "/scheduled_at",
              code: "invalid_datetime",
              message: "not a datetime",
            },
          ],
        }),
    ]);
    const err = await client(fetchImpl)
      .posts.create(
        { variants: [{ channel_id: "c", body: "b" }], draft: true },
        { idempotencyKey: "fixed" },
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityError);
    expect((err as APIError).fieldErrors).toEqual([
      {
        pointer: "/scheduled_at",
        code: "invalid_datetime",
        message: "not a datetime",
      },
    ]);
  });

  it("distinguishes rate_limited from quota_exhausted on the same 429 class", async () => {
    const { fetchImpl } = stubFetch([
      () => problemResponse(429, "quota_exhausted"),
    ]);
    const err = await client(fetchImpl)
      .usage.get()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).code).toBe("quota_exhausted");
  });

  it("parses Retry-After in both delay-seconds and HTTP-date forms", async () => {
    const { fetchImpl } = stubFetch([
      () =>
        problemResponse(429, "quota_exhausted", {}, { "Retry-After": "42" }),
      () =>
        problemResponse(
          429,
          "quota_exhausted",
          {},
          { "Retry-After": new Date(Date.now() + 90_000).toUTCString() },
        ),
    ]);
    const c = client(fetchImpl);
    const secondsErr = (await c.usage
      .get()
      .catch((e: unknown) => e)) as RateLimitError;
    expect(secondsErr.retryAfterSeconds).toBe(42);
    const dateErr = (await c.usage
      .get()
      .catch((e: unknown) => e)) as RateLimitError;
    expect(dateErr.retryAfterSeconds).toBeGreaterThan(80);
    expect(dateErr.retryAfterSeconds).toBeLessThanOrEqual(91);
  });

  it("tolerates a non-problem error body (intermediary HTML page): code is null, status still typed", async () => {
    const { fetchImpl } = stubFetch([
      () =>
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    ]);
    const err = await client(fetchImpl)
      .usage.get()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe(502);
    expect((err as APIError).code).toBeNull();
    expect((err as APIError).problem).toBeNull();
  });

  it("passes unknown future problem codes through instead of throwing on them (forward compatibility)", async () => {
    const { fetchImpl } = stubFetch([
      () => problemResponse(404, "some_future_code"),
    ]);
    const err = await client(fetchImpl)
      .posts.get("post_1")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as APIError).code).toBe("some_future_code");
  });

  it("401 maps to AuthenticationError; 2xx with unparseable JSON throws loudly", async () => {
    const { fetchImpl } = stubFetch([
      () => problemResponse(401, "invalid_api_key"),
      () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ]);
    const c = client(fetchImpl);
    await expect(c.usage.get()).rejects.toThrow(AuthenticationError);
    await expect(c.usage.get()).rejects.toThrow(/could not parse/);
  });

  it("exposes the raw Response + Idempotency-Replayed via the request escape hatch", async () => {
    const { fetchImpl } = stubFetch([
      () =>
        jsonResponse(201, { id: "post_1" }, { "Idempotency-Replayed": "true" }),
    ]);
    const result = await client(fetchImpl).request<{ id: string }>({
      method: "POST",
      path: "/v1/posts",
      body: { variants: [] },
      idempotencyKey: "abc",
    });
    expect(result.data.id).toBe("post_1");
    expect(result.requestId).toBe("req_test123");
    expect(result.response.headers.get("Idempotency-Replayed")).toBe("true");
  });
});
