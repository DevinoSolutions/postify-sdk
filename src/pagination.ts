import type { CursorPage } from "./types.js";

/**
 * Cursor pagination (API D2): list endpoints return
 * `{ data, has_more, next_cursor }`; the next page is fetched by passing
 * `next_cursor` as `after`. `PagePromise` gives both ergonomics:
 *
 *   // auto-pagination — iterate ITEMS across every page
 *   for await (const post of postify.posts.list({ status: "scheduled" })) …
 *
 *   // page escape hatch — await ONE page, walk manually
 *   const page = await postify.posts.list();
 *   const next = await page.getNextPage();
 */

export class Page<Item> implements CursorPage<Item> {
  readonly data: Item[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;

  readonly #fetchAfter: (after: string) => Promise<Page<Item>>;

  constructor(
    raw: CursorPage<Item>,
    fetchAfter: (after: string) => Promise<Page<Item>>,
  ) {
    this.data = raw.data;
    this.has_more = raw.has_more;
    this.next_cursor = raw.next_cursor;
    this.#fetchAfter = fetchAfter;
  }

  /** The next page, or null when this is the last one. */
  async getNextPage(): Promise<Page<Item> | null> {
    if (!this.has_more || this.next_cursor == null) return null;
    return this.#fetchAfter(this.next_cursor);
  }

  /** Iterate this page's items and every following page's. */
  async *[Symbol.asyncIterator](): AsyncIterator<Item> {
    // oxlint-disable-next-line no-this-alias
    let page: Page<Item> | null = this;
    while (page) {
      for (const item of page.data) yield item;
      page = await page.getNextPage();
    }
  }
}

/**
 * Awaitable AND async-iterable handle returned by cursor-list methods.
 * `await` it for the first `Page`; `for await` it for items across all pages.
 */
export class PagePromise<Item>
  implements PromiseLike<Page<Item>>, AsyncIterable<Item>
{
  readonly #first: Promise<Page<Item>>;

  constructor(first: Promise<Page<Item>>) {
    this.#first = first;
  }

  // oxlint-disable-next-line unicorn/no-thenable -- 2026-07-20 deliberately thenable: PagePromise IS the awaitable+iterable dual handle (Stripe/OpenAI SDK list pattern); `await client.posts.list()` must resolve to one Page.
  then<R1 = Page<Item>, R2 = never>(
    onfulfilled?: ((value: Page<Item>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.#first.then(onfulfilled, onrejected);
  }

  catch<R = never>(
    onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null,
  ): Promise<Page<Item> | R> {
    return this.#first.catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<Page<Item>> {
    return this.#first.finally(onfinally);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Item> {
    const page = await this.#first;
    yield* page;
  }
}
