/**
 * Public wire types for the Postify /v1 API.
 *
 * These are HAND-WRITTEN so the published `.d.ts` stands alone (no zod, no
 * private workspace packages in the declaration graph) — but they are NOT a
 * free-drifting copy: `src/__tests__/contract-parity-pins-sdk-types-to-contracts.test.ts`
 * pins every type here against the canonical zod schemas in
 * `@postify/contracts` (mutual assignability + identical key sets), so a
 * contract change that isn't mirrored here fails the monorepo's tsc gate.
 *
 * Wire conventions (API D2): snake_case field names, ISO-8601 UTC datetime
 * strings, stable opaque ids. Enum-like unions are typed closed to match the
 * server's current vocabulary; new values MAY appear over time (additive API
 * evolution) — handle unknown values generically in `switch` statements.
 */

// ─── Problems (RFC 9457) ────────────────────────────────────────────────────

/** Finite machine-readable error codes — the value SDK consumers branch on. */
export type ProblemCode =
  | "invalid_request"
  | "validation_failed"
  | "authentication_required"
  | "invalid_api_key"
  | "insufficient_scope"
  | "feature_not_enabled"
  | "dangerous_ops_disabled"
  | "resource_not_found"
  | "resource_conflict"
  | "idempotency_in_progress"
  | "idempotency_key_reused"
  | "rate_limited"
  | "quota_exhausted"
  | "internal_error";

export interface ProblemFieldError {
  /** JSON Pointer to the offending field, e.g. `"/scheduled_at"`. */
  pointer: string;
  /** Stable machine-readable field-level code. */
  code: string;
  /** Human-readable explanation. */
  message: string;
}

/** RFC 9457 problem document — every non-2xx /v1 response has this shape. */
export interface Problem {
  /** URI identifying the problem class; resolves to a documentation page. */
  type: string;
  /** Short human-readable summary of the problem class. */
  title: string;
  /** HTTP status code, duplicated from the response line. */
  status: number;
  /** Occurrence-specific human explanation. Never parse it. */
  detail?: string;
  /** Finite stable code — branch on this. Unknown values may appear. */
  code: ProblemCode;
  /** Request correlation id (same as the `Request-Id` response header). */
  request_id: string;
  /** Field-level validation errors (`validation_failed` only). */
  errors?: ProblemFieldError[];
}

// ─── Channels ───────────────────────────────────────────────────────────────

/** Normalized app-level platform union (both Instagram flavors read "instagram"). */
export type Platform =
  | "x"
  | "linkedin"
  | "facebook"
  | "instagram"
  | "threads"
  | "tiktok"
  | "pinterest"
  | "youtube"
  | "bluesky"
  | "reddit";

export type ChannelStatus =
  | "live"
  | "reauth_required"
  | "rate_limited"
  | "disabled";

/** A connected social account. */
export interface Channel {
  /** Stable channel identifier. Use it in post variants. */
  id: string;
  platform: Platform;
  /** Account handle or display name, e.g. `"@postifyhq"`. */
  handle: string;
  avatar_url: string | null;
  /** Follower count at last sync, if available. */
  followers: number | null;
  /** Only `live` channels can publish. */
  status: ChannelStatus;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
}

/** All connected channels (not paginated — plan-bounded). */
export interface ChannelList {
  data: Channel[];
}

// ─── Posts ──────────────────────────────────────────────────────────────────

export type PostStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "needs_approval";

export type PostType = "single" | "thread" | "carousel" | "long";

export type DeliveryStage =
  | "queued"
  | "signed"
  | "sent"
  | "acked"
  | "indexed"
  | "failed"
  | "dlq";

/** One media attachment. */
export interface PostMediaItem {
  /** Media URL. Use the `url` returned by /v1/media assets. */
  url: string;
  type: "image" | "video";
  /** Accessibility alt text, where the platform supports it. */
  alt?: string | null;
}

/** Per-channel tailoring of a post. */
export interface PostVariant {
  id: string;
  /** The channel this variant publishes to (see /v1/channels). */
  channel_id: string;
  body: string;
  media: PostMediaItem[];
}

/** Per-channel delivery outcome of a publish. */
export interface PostDelivery {
  channel_id: string;
  /** `indexed`/`acked` = success; `failed`/`dlq` = terminal failure. */
  stage: DeliveryStage;
  /** The platform's id for the published item, once known. */
  external_id: string | null;
  error: string | null;
}

/** A post across one or more channels. */
export interface Post {
  id: string;
  /** A `published` post can still contain failed channels — check `deliveries`. */
  status: PostStatus;
  type: PostType;
  /** Internal title (not published to platforms). */
  title: string | null;
  /** Channel-agnostic base text the variants derive from. */
  body: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  variants: PostVariant[];
  /** Empty until a publish is attempted. */
  deliveries: PostDelivery[];
}

export interface ListPostsParams {
  /** Page size (1–100, default 25). */
  limit?: number;
  /** Opaque cursor from a previous page's `next_cursor`. */
  after?: string;
  /** Filter by lifecycle state. */
  status?: PostStatus;
}

export interface CreatePostVariantParams {
  /** A connected channel's `id` (see /v1/channels). */
  channel_id: string;
  /** The text to publish to this channel. */
  body: string;
  media?: PostMediaItem[];
}

/**
 * Exactly one of `draft: true`, `scheduled_at`, or `publish_now: true` is
 * required (`publish_now` additionally needs the workspace's
 * dangerous-operations toggle for API callers).
 */
export interface CreatePostParams {
  /** One variant per target channel. */
  variants: CreatePostVariantParams[];
  /** Internal title (not published). */
  title?: string | null;
  /** Optional channel-agnostic base text. */
  body?: string | null;
  /** Save as a draft (no scheduling, no publishing). */
  draft?: boolean;
  /** Future publish time (ISO-8601). */
  scheduled_at?: string;
  /** Publish immediately. */
  publish_now?: boolean;
}

export interface ReschedulePostParams {
  /** The new future publish time (ISO-8601). */
  scheduled_at: string;
}

export interface DeletePostResponse {
  id: string;
  deleted: true;
}

/** Publish accepted — poll `posts.get(id)` for per-channel `deliveries`. */
export interface PublishPostResponse {
  id: string;
  status: PostStatus;
}

// ─── Media ──────────────────────────────────────────────────────────────────

export type MediaKind = "image" | "video" | "audio" | "raw";

export type MediaStatus = "pending" | "ready" | "failed";

/** A media library asset. */
export interface MediaAsset {
  id: string;
  filename: string;
  content_type: string;
  kind: MediaKind;
  /** Only `ready` assets should be attached to posts. */
  status: MediaStatus;
  /** Durable URL — use as `media[].url` when creating posts. Null until completed. */
  url: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  created_at: string;
}

export interface ListMediaParams {
  /** Page size (1–100, default 25). */
  limit?: number;
  /** Opaque cursor from a previous page's `next_cursor`. */
  after?: string;
}

export interface CreateMediaUploadParams {
  /** Filename including extension. */
  filename: string;
  /** MIME type of the bytes you will upload. */
  content_type: string;
  /** Size in bytes, if known. */
  size_bytes?: number;
}

/** Upload ticket: PUT the bytes to `upload_url`, then complete the upload. */
export interface MediaUploadTicket {
  /** The pending asset — complete it after the PUT succeeds. */
  asset_id: string;
  /** Presigned URL. PUT the raw bytes here with the same Content-Type. */
  upload_url: string;
  method: "PUT";
  /** When the presigned URL stops working (ISO-8601 UTC). */
  expires_at: string;
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export interface AnalyticsTimelinePoint {
  /** UTC calendar day (YYYY-MM-DD). */
  date: string;
  published: number;
}

/** Workspace analytics summary. */
export interface Analytics {
  totals: {
    posts: number;
    published: number;
    scheduled: number;
    failed: number;
    channels: number;
  };
  delivery: {
    attempts: number;
    /** Success fraction of SETTLED attempts; null when nothing has settled. */
    success_rate: number | null;
  };
  /** Publishes per UTC day over the last 14 days. */
  timeline: AnalyticsTimelinePoint[];
  /** Zeros when metrics have not synced yet. */
  engagement: {
    impressions: number;
    likes: number;
    comments: number;
    shares: number;
    clicks: number;
  };
}

// ─── Usage ──────────────────────────────────────────────────────────────────

export type UsageMeterKey =
  | "posts_per_month"
  | "channels"
  | "team_members"
  | "ai_credits"
  | "transcription_minutes"
  | "integrations"
  | "api_requests";

/** One plan meter. */
export interface UsageMeter {
  key: UsageMeterKey;
  used: number;
  /** Plan ceiling for the period. Null means unlimited. */
  limit: number | null;
  /** `limit - used`, floored at 0. Null when unlimited. */
  remaining: number | null;
  period_starts_at: string | null;
  /** When the meter resets. Null when the period is open-ended. */
  period_ends_at: string | null;
}

/** Plan + meter consumption. */
export interface Usage {
  /** The workspace's effective plan tier. */
  plan: string;
  meters: UsageMeter[];
}

// ─── Webhook endpoints ──────────────────────────────────────────────────────

export type WebhookEventType =
  | "post.published"
  | "post.failed"
  | "channel.connected"
  | "channel.reauth_required"
  | "delivery.failed";

/**
 * The JSON body of every webhook delivery. Verify the Standard-Webhooks
 * signature over the RAW request bytes before parsing (see `verifyWebhook`).
 * The envelope is grandfathered camelCase.
 */
export interface WebhookEvent {
  /** Stable event id — same as the `webhook-id` header across retries/replays. Your dedup key. */
  id: string;
  /** Event type, e.g. `"post.published"`. `webhook.test` is the synthetic ping. */
  type: string;
  createdAt: string;
  /** Event-specific payload, documented per event type in the catalog. */
  data: Record<string, unknown>;
}

/** An outbound webhook endpoint (subscriber). */
export interface WebhookEndpoint {
  id: string;
  url: string;
  event_types: WebhookEventType[];
  /** Set to `false` automatically after 20 consecutive failed deliveries. */
  enabled: boolean;
  auto_disabled_at: string | null;
  /** Warning emails at 5/10/15; auto-disable at 20; any 2xx resets to 0. */
  consecutive_failures: number;
  created_at: string;
}

/** All webhook endpoints (not paginated — plan-bounded). */
export interface WebhookEndpointList {
  data: WebhookEndpoint[];
}

export interface CreateWebhookEndpointParams {
  /** HTTPS URL on port 443. Private/internal addresses are rejected. */
  url: string;
  /** Event types to subscribe to (at least one). */
  event_types: WebhookEventType[];
}

/** The created endpoint plus its SHOW-ONCE signing secret — store it now. */
export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  /** Standard-Webhooks signing secret (`whsec_` + base64). Not retrievable later. */
  signing_secret: string;
}

/** Partial update — at least one field is required. */
export interface UpdateWebhookEndpointParams {
  url?: string;
  event_types?: WebhookEventType[];
  /** `true` on an auto-disabled endpoint clears its failure state. */
  enabled?: boolean;
}

export interface DeleteWebhookEndpointResponse {
  id: string;
  deleted: true;
}

/** Outcome of a synthetic `webhook.test` delivery, signed like a real event. */
export interface WebhookTestResult {
  delivery_id: string;
  succeeded: boolean;
  /** Null when the request never completed (timeout, TLS failure, blocked egress). */
  http_code: number | null;
  error: string | null;
}

// ─── Cursor pages (generic wire shape) ──────────────────────────────────────

/** One page of a cursor-paginated list (`posts.list`, `media.list`). */
export interface CursorPage<Item> {
  data: Item[];
  /** True when another page exists after `next_cursor`. */
  has_more: boolean;
  /** Opaque cursor for the next page — pass as `after`. */
  next_cursor: string | null;
}
