import type { CallOptions, Postify } from "../client.js";
import { Page, PagePromise } from "../pagination.js";
import type {
  CreatePostParams,
  CursorPage,
  DeletePostResponse,
  ListPostsParams,
  Post,
  PublishPostResponse,
  ReschedulePostParams,
} from "../types.js";

export interface CreatePostOptions extends CallOptions {
  /**
   * Idempotency key for safe retries. When omitted (and the client's
   * `autoIdempotencyKeys` default is on) a UUID is generated for you, so
   * network retries can never create duplicate posts.
   */
  idempotencyKey?: string;
}

/** `/v1/posts` — scopes: `posts:read` / `posts:write`. */
export class PostsResource {
  readonly #client: Postify;

  constructor(client: Postify) {
    this.#client = client;
  }

  /** List posts, newest first. Awaitable for one page, iterable for all. */
  list(params?: ListPostsParams, options?: CallOptions): PagePromise<Post> {
    const fetchPage = async (after?: string): Promise<Page<Post>> => {
      const { data } = await this.#client.request<CursorPage<Post>>({
        op: "listPosts",
        method: "GET",
        path: "/v1/posts",
        query: { ...params, after: after ?? params?.after },
        ...options,
      });
      return new Page(data, (cursor) => fetchPage(cursor));
    };
    return new PagePromise(fetchPage());
  }

  /**
   * Create a post — exactly one of `draft: true`, `scheduled_at`, or
   * `publish_now: true` is required.
   */
  async create(
    params: CreatePostParams,
    options?: CreatePostOptions,
  ): Promise<Post> {
    const idempotencyKey =
      options?.idempotencyKey ??
      (this.#client.autoIdempotencyKeys ? crypto.randomUUID() : undefined);
    const { data } = await this.#client.request<Post>({
      op: "createPost",
      method: "POST",
      path: "/v1/posts",
      body: params,
      idempotencyKey,
      ...options,
    });
    return data;
  }

  /** Fetch one post, including per-channel `deliveries`. */
  async get(id: string, options?: CallOptions): Promise<Post> {
    const { data } = await this.#client.request<Post>({
      op: "getPost",
      method: "GET",
      path: `/v1/posts/${encodeURIComponent(id)}`,
      ...options,
    });
    return data;
  }

  /** Move a scheduled post to a new future time. */
  async reschedule(
    id: string,
    params: ReschedulePostParams,
    options?: CallOptions,
  ): Promise<Post> {
    const { data } = await this.#client.request<Post>({
      op: "reschedulePost",
      method: "PATCH",
      path: `/v1/posts/${encodeURIComponent(id)}`,
      body: params,
      ...options,
    });
    return data;
  }

  /** Delete a post. */
  async delete(id: string, options?: CallOptions): Promise<DeletePostResponse> {
    const { data } = await this.#client.request<DeletePostResponse>({
      op: "deletePost",
      method: "DELETE",
      path: `/v1/posts/${encodeURIComponent(id)}`,
      ...options,
    });
    return data;
  }

  /**
   * Publish an existing draft/scheduled post now (202 — delivery continues in
   * the background; poll `get(id)`). Requires the workspace's
   * dangerous-operations toggle for API callers.
   */
  async publish(
    id: string,
    options?: CallOptions,
  ): Promise<PublishPostResponse> {
    const { data } = await this.#client.request<PublishPostResponse>({
      op: "publishPost",
      method: "POST",
      path: `/v1/posts/${encodeURIComponent(id)}/publish`,
      ...options,
    });
    return data;
  }
}
