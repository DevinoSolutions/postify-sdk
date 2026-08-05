import {
  AnalyticsResponse,
  CHANNEL_STATUSES,
  ChannelListResponse,
  DeletePostResponse as ContractDeletePostResponse,
  DeleteWebhookEndpointResponse as ContractDeleteWebhookEndpointResponse,
  Problem as ContractProblem,
  PublishPostResponse as ContractPublishPostResponse,
  CreatePostRequest,
  CreateUploadRequest,
  CreateUploadResponse,
  CreateWebhookEndpointRequest,
  PostListResponse,
  PROBLEM_CODE_LIST,
  PUBLIC_DELIVERY_STAGES,
  PUBLIC_MEDIA_KINDS,
  PUBLIC_MEDIA_STATUSES,
  PUBLIC_POST_STATUSES,
  PUBLIC_POST_TYPES,
  PUBLIC_USAGE_METERS,
  PublicChannel,
  PublicMediaAsset,
  PublicPost,
  PublicWebhookEndpoint,
  ReschedulePostRequest,
  TestWebhookEndpointResponse,
  UpdateWebhookEndpointRequest,
  UsageResponse,
  WEBHOOK_EVENT_TYPES,
  WebhookEndpointCreateResponse,
  WebhookEndpointListResponse,
  WebhookEventEnvelope,
  type ProblemCode as ContractProblemCode,
} from "@postify/contracts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type * as sdk from "../types.js";
import { VERSION } from "../version.js";

/**
 * THE drift pin (open-api D9): the SDK's hand-written public types must stay
 * structurally identical to the canonical zod schemas in @postify/contracts.
 * Every pair below is checked for mutual assignability AND identical key
 * sets at compile time — this file failing tsc/vitest IS the contract-drift
 * alarm. Request bodies pin against `z.input` (defaults optional on the way
 * in); responses pin against `z.infer` (the serialized output).
 */

type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
type SameKeys<A, B> = MutuallyAssignable<keyof A, keyof B>;
/** Object pin: assignable both ways + no missing/extra (even optional) keys. */
type PinObject<A, B> =
  MutuallyAssignable<A, B> extends true ? SameKeys<A, B> : false;
/** Union / scalar pin: assignable both ways. */
type PinType<A, B> = MutuallyAssignable<A, B>;
type Expect<T extends true> = T;

// oxlint-disable-next-line no-unused-vars
type _pins = [
  // Problems
  Expect<PinObject<sdk.Problem, z.infer<typeof ContractProblem>>>,
  Expect<PinType<sdk.ProblemCode, ContractProblemCode>>,
  // Channels
  Expect<PinObject<sdk.Channel, z.infer<typeof PublicChannel>>>,
  Expect<PinObject<sdk.ChannelList, z.infer<typeof ChannelListResponse>>>,
  Expect<PinType<sdk.ChannelStatus, (typeof CHANNEL_STATUSES)[number]>>,
  Expect<PinType<sdk.Platform, z.infer<typeof PublicChannel>["platform"]>>,
  // Posts
  Expect<PinObject<sdk.Post, z.infer<typeof PublicPost>>>,
  Expect<PinType<sdk.PostStatus, (typeof PUBLIC_POST_STATUSES)[number]>>,
  Expect<PinType<sdk.PostType, (typeof PUBLIC_POST_TYPES)[number]>>,
  Expect<PinType<sdk.DeliveryStage, (typeof PUBLIC_DELIVERY_STAGES)[number]>>,
  Expect<PinObject<sdk.CursorPage<sdk.Post>, z.infer<typeof PostListResponse>>>,
  Expect<PinObject<sdk.CreatePostParams, z.input<typeof CreatePostRequest>>>,
  Expect<
    PinObject<sdk.ReschedulePostParams, z.input<typeof ReschedulePostRequest>>
  >,
  Expect<
    PinObject<
      sdk.DeletePostResponse,
      z.infer<typeof ContractDeletePostResponse>
    >
  >,
  Expect<
    PinObject<
      sdk.PublishPostResponse,
      z.infer<typeof ContractPublishPostResponse>
    >
  >,
  // Media
  Expect<PinObject<sdk.MediaAsset, z.infer<typeof PublicMediaAsset>>>,
  Expect<PinType<sdk.MediaKind, (typeof PUBLIC_MEDIA_KINDS)[number]>>,
  Expect<PinType<sdk.MediaStatus, (typeof PUBLIC_MEDIA_STATUSES)[number]>>,
  Expect<
    PinObject<sdk.CreateMediaUploadParams, z.input<typeof CreateUploadRequest>>
  >,
  Expect<
    PinObject<sdk.MediaUploadTicket, z.infer<typeof CreateUploadResponse>>
  >,
  // Analytics + usage
  Expect<PinObject<sdk.Analytics, z.infer<typeof AnalyticsResponse>>>,
  Expect<PinObject<sdk.Usage, z.infer<typeof UsageResponse>>>,
  Expect<PinType<sdk.UsageMeterKey, (typeof PUBLIC_USAGE_METERS)[number]>>,
  // Webhooks
  Expect<PinType<sdk.WebhookEventType, (typeof WEBHOOK_EVENT_TYPES)[number]>>,
  Expect<PinObject<sdk.WebhookEvent, z.infer<typeof WebhookEventEnvelope>>>,
  Expect<PinObject<sdk.WebhookEndpoint, z.infer<typeof PublicWebhookEndpoint>>>,
  Expect<
    PinObject<
      sdk.WebhookEndpointList,
      z.infer<typeof WebhookEndpointListResponse>
    >
  >,
  Expect<
    PinObject<
      sdk.WebhookEndpointWithSecret,
      z.infer<typeof WebhookEndpointCreateResponse>
    >
  >,
  Expect<
    PinObject<
      sdk.CreateWebhookEndpointParams,
      z.input<typeof CreateWebhookEndpointRequest>
    >
  >,
  Expect<
    PinObject<
      sdk.UpdateWebhookEndpointParams,
      z.input<typeof UpdateWebhookEndpointRequest>
    >
  >,
  Expect<
    PinObject<
      sdk.DeleteWebhookEndpointResponse,
      z.infer<typeof ContractDeleteWebhookEndpointResponse>
    >
  >,
  Expect<
    PinObject<
      sdk.WebhookTestResult,
      z.infer<typeof TestWebhookEndpointResponse>
    >
  >,
];

describe("SDK types stay pinned to @postify/contracts", () => {
  it("carries every problem code the contracts registry defines (type pins enforce membership)", () => {
    // The type-level pins above are the real guard; this run-time check keeps
    // the suite honest about the registry actually being loaded.
    expect(PROBLEM_CODE_LIST.length).toBe(14);
    expect(PROBLEM_CODE_LIST).toContain("rate_limited");
    expect(PROBLEM_CODE_LIST).toContain("quota_exhausted");
  });

  it("VERSION matches package.json (Changesets bumps the manifest; version.ts must follow)", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
