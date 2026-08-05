import { afterEach, describe, expect, it } from "vitest";
import { Postify, redactApiKey } from "../client.js";
import { PostifyError } from "../errors.js";
import { VERSION } from "../version.js";
import { jsonResponse, stubFetch } from "./helpers/fetch-stub.js";

describe("auth header forms, identification headers, browser guard, idempotency defaults", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("sends Authorization: Bearer by default and x-api-key when configured", async () => {
    const { fetchImpl, requests } = stubFetch([
      () => jsonResponse(200, { plan: "team", meters: [] }),
    ]);
    await new Postify({
      apiKey: "postify_live_abcd1234",
      fetch: fetchImpl,
    }).usage.get();
    expect(requests[0]!.headers.get("Authorization")).toBe(
      "Bearer postify_live_abcd1234",
    );
    expect(requests[0]!.headers.get("x-api-key")).toBeNull();

    await new Postify({
      apiKey: "postify_live_abcd1234",
      authMethod: "x-api-key",
      fetch: fetchImpl,
    }).usage.get();
    expect(requests[1]!.headers.get("x-api-key")).toBe("postify_live_abcd1234");
    expect(requests[1]!.headers.get("Authorization")).toBeNull();
  });

  it("identifies itself with User-Agent and x-postify-sdk-version", async () => {
    const { fetchImpl, requests } = stubFetch([
      () => jsonResponse(200, { plan: "free", meters: [] }),
    ]);
    await new Postify({
      apiKey: "postify_test_ua1234",
      fetch: fetchImpl,
    }).usage.get();
    expect(requests[0]!.headers.get("User-Agent")).toContain(
      `postify-sdk/${VERSION}`,
    );
    expect(requests[0]!.headers.get("x-postify-sdk-version")).toBe(VERSION);
  });

  it("refuses to construct in a browser without dangerouslyAllowBrowser", () => {
    (globalThis as { window?: unknown }).window = { document: {} };
    expect(() => new Postify({ apiKey: "postify_live_browser1234" })).toThrow(
      /Refusing to run in a browser/,
    );
    expect(
      () =>
        new Postify({
          apiKey: "postify_live_browser1234",
          dangerouslyAllowBrowser: true,
        }),
    ).not.toThrow();
  });

  it("throws a setup-guiding error when apiKey is missing", () => {
    expect(() => new Postify({ apiKey: "" })).toThrow(PostifyError);
    expect(() => new Postify({ apiKey: "" })).toThrow(/Settings → API keys/);
  });

  it("redacts keys to prefix + last 4 for logs", () => {
    expect(redactApiKey("postify_live_abcdefghijkl9999")).toBe(
      "postify_live_…9999",
    );
    expect(redactApiKey("pk_test_abcdef123456")).toBe("pk_test_…3456");
  });

  it("debug logging emits the redacted fingerprint, never the key", () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    void new Postify({
      apiKey: "postify_live_secretsecret1234",
      debug: (event, data) => events.push({ event, data }),
    });
    const init = events.find((e) => e.event === "client_initialized");
    expect(init?.data.apiKey).toBe("postify_live_…1234");
    expect(JSON.stringify(events)).not.toContain("secretsecret");
  });

  it("posts.create auto-generates a UUID Idempotency-Key; an explicit key wins; opting out disables it", async () => {
    const { fetchImpl, requests } = stubFetch([
      () => jsonResponse(201, { id: "post_1" }),
    ]);
    const body = {
      variants: [{ channel_id: "ch_1", body: "hi" }],
      draft: true,
    };

    await new Postify({
      apiKey: "postify_test_idem1",
      fetch: fetchImpl,
    }).posts.create(body);
    expect(requests[0]!.headers.get("Idempotency-Key")).toMatch(
      /^[0-9a-f-]{36}$/,
    );

    await new Postify({
      apiKey: "postify_test_idem1",
      fetch: fetchImpl,
    }).posts.create(body, { idempotencyKey: "my-key-1" });
    expect(requests[1]!.headers.get("Idempotency-Key")).toBe("my-key-1");

    await new Postify({
      apiKey: "postify_test_idem1",
      autoIdempotencyKeys: false,
      fetch: fetchImpl,
    }).posts.create(body);
    expect(requests[2]!.headers.get("Idempotency-Key")).toBeNull();
  });

  it("other mutations (publish, webhook test) never invent an idempotency key", async () => {
    const { fetchImpl, requests } = stubFetch([
      () => jsonResponse(202, { id: "post_1", status: "publishing" }),
      () =>
        jsonResponse(200, {
          delivery_id: "d1",
          succeeded: true,
          http_code: 200,
          error: null,
        }),
    ]);
    const c = new Postify({ apiKey: "postify_test_idem2", fetch: fetchImpl });
    await c.posts.publish("post_1");
    await c.webhookEndpoints.test("we_1");
    expect(requests[0]!.headers.get("Idempotency-Key")).toBeNull();
    expect(requests[1]!.headers.get("Idempotency-Key")).toBeNull();
  });
});
