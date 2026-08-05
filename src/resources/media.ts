import type { CallOptions, Postify } from "../client.js";
import { Page, PagePromise } from "../pagination.js";
import type {
  CreateMediaUploadParams,
  CursorPage,
  ListMediaParams,
  MediaAsset,
  MediaUploadTicket,
} from "../types.js";

/**
 * `/v1/media` — rides the `posts:*` scopes (there is no separate media
 * scope). Upload flow: `createUpload` → PUT the bytes to `upload_url` with
 * the same Content-Type → `completeUpload(asset_id)` → attach the returned
 * `url` to post variants.
 */
export class MediaResource {
  readonly #client: Postify;

  constructor(client: Postify) {
    this.#client = client;
  }

  /** List media assets, newest first. Awaitable for one page, iterable for all. */
  list(
    params?: ListMediaParams,
    options?: CallOptions,
  ): PagePromise<MediaAsset> {
    const fetchPage = async (after?: string): Promise<Page<MediaAsset>> => {
      const { data } = await this.#client.request<CursorPage<MediaAsset>>({
        op: "listMedia",
        method: "GET",
        path: "/v1/media",
        query: { ...params, after: after ?? params?.after },
        ...options,
      });
      return new Page(data, (cursor) => fetchPage(cursor));
    };
    return new PagePromise(fetchPage());
  }

  /** Create an upload ticket (presigned PUT). */
  async createUpload(
    params: CreateMediaUploadParams,
    options?: CallOptions,
  ): Promise<MediaUploadTicket> {
    const { data } = await this.#client.request<MediaUploadTicket>({
      op: "createMediaUpload",
      method: "POST",
      path: "/v1/media/uploads",
      body: params,
      ...options,
    });
    return data;
  }

  /** Finalize an upload after the presigned PUT succeeded. */
  async completeUpload(
    assetId: string,
    options?: CallOptions,
  ): Promise<MediaAsset> {
    const { data } = await this.#client.request<MediaAsset>({
      op: "completeMediaUpload",
      method: "POST",
      path: `/v1/media/uploads/${encodeURIComponent(assetId)}/complete`,
      ...options,
    });
    return data;
  }
}
