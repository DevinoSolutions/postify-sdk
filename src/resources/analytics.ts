import type { CallOptions, Postify } from "../client.js";
import type { Analytics } from "../types.js";

/** `/v1/analytics` — scope: `analytics:read`. */
export class AnalyticsResource {
  readonly #client: Postify;

  constructor(client: Postify) {
    this.#client = client;
  }

  /** Workspace analytics summary (counts, delivery health, 14-day timeline). */
  async get(options?: CallOptions): Promise<Analytics> {
    const { data } = await this.#client.request<Analytics>({
      op: "getAnalytics",
      method: "GET",
      path: "/v1/analytics",
      ...options,
    });
    return data;
  }
}
