import type { CallOptions, Postify } from "../client.js";
import type {
  CreateWebhookEndpointParams,
  DeleteWebhookEndpointResponse,
  UpdateWebhookEndpointParams,
  WebhookEndpoint,
  WebhookEndpointList,
  WebhookEndpointWithSecret,
  WebhookTestResult,
} from "../types.js";

/** `/v1/webhook-endpoints` — scopes: `webhooks:read` / `webhooks:write`. */
export class WebhookEndpointsResource {
  readonly #client: Postify;

  constructor(client: Postify) {
    this.#client = client;
  }

  /** All webhook endpoints (not paginated — plan-bounded). */
  async list(options?: CallOptions): Promise<WebhookEndpointList> {
    const { data } = await this.#client.request<WebhookEndpointList>({
      op: "listWebhookEndpoints",
      method: "GET",
      path: "/v1/webhook-endpoints",
      ...options,
    });
    return data;
  }

  /**
   * Create an endpoint. The response carries the SHOW-ONCE `signing_secret`
   * — store it immediately; it is not retrievable later.
   */
  async create(
    params: CreateWebhookEndpointParams,
    options?: CallOptions,
  ): Promise<WebhookEndpointWithSecret> {
    const { data } = await this.#client.request<WebhookEndpointWithSecret>({
      op: "createWebhookEndpoint",
      method: "POST",
      path: "/v1/webhook-endpoints",
      body: params,
      ...options,
    });
    return data;
  }

  /** Partial update; `enabled: true` also clears auto-disable failure state. */
  async update(
    id: string,
    params: UpdateWebhookEndpointParams,
    options?: CallOptions,
  ): Promise<WebhookEndpoint> {
    const { data } = await this.#client.request<WebhookEndpoint>({
      op: "updateWebhookEndpoint",
      method: "PATCH",
      path: `/v1/webhook-endpoints/${encodeURIComponent(id)}`,
      body: params,
      ...options,
    });
    return data;
  }

  /** Delete an endpoint. */
  async delete(
    id: string,
    options?: CallOptions,
  ): Promise<DeleteWebhookEndpointResponse> {
    const { data } = await this.#client.request<DeleteWebhookEndpointResponse>({
      op: "deleteWebhookEndpoint",
      method: "DELETE",
      path: `/v1/webhook-endpoints/${encodeURIComponent(id)}`,
      ...options,
    });
    return data;
  }

  /** Send a synthetic `webhook.test` event, signed exactly like a real one. */
  async test(id: string, options?: CallOptions): Promise<WebhookTestResult> {
    const { data } = await this.#client.request<WebhookTestResult>({
      op: "testWebhookEndpoint",
      method: "POST",
      path: `/v1/webhook-endpoints/${encodeURIComponent(id)}/test`,
      ...options,
    });
    return data;
  }
}
