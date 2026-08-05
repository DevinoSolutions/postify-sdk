import type { CallOptions, Postify } from "../client.js";
import type { ChannelList } from "../types.js";

/** `/v1/channels` — scope: `channels:read`. */
export class ChannelsResource {
  readonly #client: Postify;

  constructor(client: Postify) {
    this.#client = client;
  }

  /** All connected channels (not paginated — plan-bounded). */
  async list(options?: CallOptions): Promise<ChannelList> {
    const { data } = await this.#client.request<ChannelList>({
      op: "listChannels",
      method: "GET",
      path: "/v1/channels",
      ...options,
    });
    return data;
  }
}
