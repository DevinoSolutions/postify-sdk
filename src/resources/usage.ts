import type { CallOptions, Postify } from "../client.js";
import type { Usage } from "../types.js";

/** `/v1/usage` — readable with any valid key (no extra scope). */
export class UsageResource {
  readonly #client: Postify;

  constructor(client: Postify) {
    this.#client = client;
  }

  /** Plan + meter consumption — watch `api_requests` instead of discovering the ceiling via 429s. */
  async get(options?: CallOptions): Promise<Usage> {
    const { data } = await this.#client.request<Usage>({
      op: "getUsage",
      method: "GET",
      path: "/v1/usage",
      ...options,
    });
    return data;
  }
}
