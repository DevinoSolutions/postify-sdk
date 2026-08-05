import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Postify } from "../client.js";
import {
  APITimeoutError,
  APIUserAbortError,
  InternalServerError,
  RateLimitError,
} from "../errors.js";
import {
  jsonResponse,
  problemResponse,
  stubFetch,
} from "./helpers/fetch-stub.js";

function client(fetchImpl: typeof globalThis.fetch, extra = {}) {
  return new Postify({
    apiKey: "postify_test_retrykey1234",
    fetch: fetchImpl,
    ...extra,
  });
}

describe("retry policy (D9): Retry-After honored, unsafe mutations never retried without an idempotency key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a GET after a 500 and succeeds on the second attempt", async () => {
    const { fetchImpl, requests } = stubFetch([
      () => problemResponse(500, "internal_error"),
      () => jsonResponse(200, { data: [] }),
    ]);
    const promise = client(fetchImpl).channels.list();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ data: [] });
    expect(requests).toHaveLength(2);
  });

  it("sleeps exactly the Retry-After delay before retrying a burst-limited (rate_limited) request", async () => {
    const { fetchImpl, requests } = stubFetch([
      () => problemResponse(429, "rate_limited", {}, { "Retry-After": "7" }),
      () => jsonResponse(200, { plan: "team", meters: [] }),
    ]);
    const promise = client(fetchImpl).usage.get();
    // Let the first attempt settle and the retry sleep get scheduled.
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6900);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toEqual({ plan: "team", meters: [] });
    expect(requests).toHaveLength(2);
  });

  it("never retries quota_exhausted (period allowance) even though it is a 429 with Retry-After", async () => {
    const { fetchImpl, requests } = stubFetch([
      () =>
        problemResponse(429, "quota_exhausted", {}, { "Retry-After": "3600" }),
    ]);
    const assertion = expect(client(fetchImpl).usage.get()).rejects.toThrow(
      RateLimitError,
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(requests).toHaveLength(1);
  });

  it("never retries an unkeyed POST mutation on a 500 (no Idempotency-Key = no retry)", async () => {
    const { fetchImpl, requests } = stubFetch([
      () => problemResponse(500, "internal_error"),
    ]);
    const assertion = expect(
      client(fetchImpl).posts.publish("post_1"),
    ).rejects.toThrow(InternalServerError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(requests).toHaveLength(1);
  });

  it("retries a keyed POST (posts.create auto-attaches an Idempotency-Key) and reuses the SAME key", async () => {
    const { fetchImpl, requests } = stubFetch([
      () => problemResponse(503, "internal_error"),
      () => jsonResponse(201, { id: "post_1" }),
    ]);
    const promise = client(fetchImpl).posts.create({
      variants: [{ channel_id: "ch_1", body: "hello" }],
      draft: true,
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ id: "post_1" });
    expect(requests).toHaveLength(2);
    const key1 = requests[0]!.headers.get("Idempotency-Key");
    const key2 = requests[1]!.headers.get("Idempotency-Key");
    expect(key1).toBeTruthy();
    expect(key1).toBe(key2);
  });

  it("retries network failures on GETs but surfaces them on unkeyed mutations", async () => {
    const boom = () => {
      throw new TypeError("fetch failed");
    };
    const { fetchImpl: flakyGet, requests: getReqs } = stubFetch([
      boom,
      () => jsonResponse(200, { data: [] }),
    ]);
    const getPromise = client(flakyGet).channels.list();
    await vi.runAllTimersAsync();
    await expect(getPromise).resolves.toEqual({ data: [] });
    expect(getReqs).toHaveLength(2);

    const { fetchImpl: flakyPost, requests: postReqs } = stubFetch([boom]);
    const postAssertion = expect(
      client(flakyPost).webhookEndpoints.test("we_1"),
    ).rejects.toThrow(/fetch failed/);
    await vi.runAllTimersAsync();
    await postAssertion;
    expect(postReqs).toHaveLength(1);
  });

  it("stops after maxRetries and throws the final error", async () => {
    const { fetchImpl, requests } = stubFetch([
      () => problemResponse(500, "internal_error"),
    ]);
    const assertion = expect(
      client(fetchImpl, { maxRetries: 2 }).usage.get(),
    ).rejects.toThrow(InternalServerError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(requests).toHaveLength(3);
  });

  it("times out an attempt after timeoutMs and reports APITimeoutError", async () => {
    const hang: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const assertion = expect(
      client(hang, { timeoutMs: 50, maxRetries: 0 }).usage.get(),
    ).rejects.toThrow(APITimeoutError);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("a caller AbortSignal surfaces APIUserAbortError and is never retried", async () => {
    const controller = new AbortController();
    let calls = 0;
    const hang: typeof globalThis.fetch = (_input, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    };
    const assertion = expect(
      client(hang).usage.get({ signal: controller.signal }),
    ).rejects.toThrow(APIUserAbortError);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.runAllTimersAsync();
    await assertion;
    expect(calls).toBe(1);
  });
});
