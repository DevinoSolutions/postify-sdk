/**
 * @postify/sdk — the official TypeScript client for the Postify public API.
 *
 *   import { Postify } from "@postify/sdk";
 *   const postify = new Postify({ apiKey: process.env.POSTIFY_API_KEY! });
 *   const { data: channels } = await postify.channels.list();
 *
 * Docs: https://app.usepostify.com/docs/api-reference
 */
export {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  Postify,
  redactApiKey,
} from "./client.js";
export type {
  ApiResult,
  CallOptions,
  ClientOptions,
  DebugLogger,
  HttpMethod,
  RequestOptions,
} from "./client.js";
export {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  PostifyError,
  RateLimitError,
  UnprocessableEntityError,
  WebhookVerificationError,
} from "./errors.js";
export { Page, PagePromise } from "./pagination.js";
export type { CreatePostOptions } from "./resources/posts.js";
export type * from "./types.js";
export { VERSION } from "./version.js";
export { WEBHOOK_TOLERANCE_SEC, verifyWebhook } from "./webhooks.js";
export type { VerifyWebhookArgs, VerifyWebhookOptions } from "./webhooks.js";
