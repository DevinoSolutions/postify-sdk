import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebhookVerificationError } from "../errors.js";
import { verifyWebhook } from "../webhooks.js";

/**
 * Independent-implementation cross-check: signatures here are produced with
 * node:crypto exactly the way the server's `lib/webhooks/sign.ts` does it,
 * then verified by the SDK's WebCrypto implementation. The direct
 * sign.ts ↔ SDK cross-verification lives in
 * apps/web/src/lib/webhooks/__tests__/sdk-verifier-cross-verifies-server-signatures.test.ts.
 */

function secretBytes(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return Buffer.from(raw, "base64");
}

function sign(secret: string, id: string, ts: number, body: string): string {
  return `v1,${createHmac("sha256", secretBytes(secret))
    .update(`${id}.${ts}.${body}`)
    .digest("base64")}`;
}

const SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const BODY = JSON.stringify({
  id: "evt_1",
  type: "post.published",
  createdAt: "2026-07-20T00:00:00.000Z",
  data: { postId: "p1" },
});
const NOW = new Date("2026-07-20T00:00:10.000Z");
const TS = Math.floor(NOW.getTime() / 1000);

function headersFor(signature: string, id = "evt_1", ts: number = TS) {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(ts),
    "webhook-signature": signature,
  };
}

describe("verifyWebhook: Standard Webhooks v1 over the raw payload bytes", () => {
  it("verifies a valid signature and returns the parsed envelope", async () => {
    const event = await verifyWebhook(
      {
        payload: BODY,
        headers: headersFor(sign(SECRET, "evt_1", TS, BODY)),
        secret: SECRET,
      },
      { now: NOW },
    );
    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("post.published");
    expect(event.data).toEqual({ postId: "p1" });
  });

  it("accepts a Headers instance and case-insensitive plain-object headers", async () => {
    const sig = sign(SECRET, "evt_1", TS, BODY);
    await expect(
      verifyWebhook(
        {
          payload: BODY,
          headers: new Headers(headersFor(sig)),
          secret: SECRET,
        },
        { now: NOW },
      ),
    ).resolves.toBeTruthy();
    await expect(
      verifyWebhook(
        {
          payload: BODY,
          headers: {
            "Webhook-Id": "evt_1",
            "WEBHOOK-TIMESTAMP": String(TS),
            "Webhook-Signature": sig,
          },
          secret: SECRET,
        },
        { now: NOW },
      ),
    ).resolves.toBeTruthy();
  });

  it("rejects a tampered payload (raw-bytes rule: any byte change breaks it)", async () => {
    const sig = sign(SECRET, "evt_1", TS, BODY);
    const tampered = BODY.replace("p1", "p2");
    await expect(
      verifyWebhook(
        { payload: tampered, headers: headersFor(sig), secret: SECRET },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ reason: "no_matching_signature" });
  });

  it("rejects timestamps outside the ±300s tolerance, in both directions", async () => {
    const oldTs = TS - 301;
    await expect(
      verifyWebhook(
        {
          payload: BODY,
          headers: headersFor(
            sign(SECRET, "evt_1", oldTs, BODY),
            "evt_1",
            oldTs,
          ),
          secret: SECRET,
        },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ reason: "timestamp_out_of_tolerance" });
    const futureTs = TS + 301;
    await expect(
      verifyWebhook(
        {
          payload: BODY,
          headers: headersFor(
            sign(SECRET, "evt_1", futureTs, BODY),
            "evt_1",
            futureTs,
          ),
          secret: SECRET,
        },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ reason: "timestamp_out_of_tolerance" });
  });

  it("accepts rotation-overlap headers where only the SECOND signature matches", async () => {
    const previousSecret = `whsec_${randomBytes(24).toString("base64")}`;
    const header = `${sign(previousSecret, "evt_1", TS, BODY)} ${sign(SECRET, "evt_1", TS, BODY)}`;
    const event = await verifyWebhook(
      { payload: BODY, headers: headersFor(header), secret: SECRET },
      { now: NOW },
    );
    expect(event.id).toBe("evt_1");
  });

  it("verifies grandfathered base64url secrets (lenient decode, mirroring the server)", async () => {
    const urlSafeSecret = `whsec_${randomBytes(24).toString("base64url")}`;
    const event = await verifyWebhook(
      {
        payload: BODY,
        headers: headersFor(sign(urlSafeSecret, "evt_1", TS, BODY)),
        secret: urlSafeSecret,
      },
      { now: NOW },
    );
    expect(event.id).toBe("evt_1");
  });

  it("reports missing and malformed headers with machine-readable reasons", async () => {
    await expect(
      verifyWebhook(
        { payload: BODY, headers: {}, secret: SECRET },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(
      verifyWebhook(
        { payload: BODY, headers: {}, secret: SECRET },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ reason: "missing_headers" });
    await expect(
      verifyWebhook(
        {
          payload: BODY,
          headers: {
            "webhook-id": "evt_1",
            "webhook-timestamp": "not-a-number",
            "webhook-signature": "v1,zzzz",
          },
          secret: SECRET,
        },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ reason: "malformed_header" });
  });

  it("ignores non-v1 signature schemes instead of trying to parse them", async () => {
    const header = `v2,${Buffer.from("future-scheme").toString("base64")} ${sign(SECRET, "evt_1", TS, BODY)}`;
    await expect(
      verifyWebhook(
        { payload: BODY, headers: headersFor(header), secret: SECRET },
        { now: NOW },
      ),
    ).resolves.toBeTruthy();
  });
});
