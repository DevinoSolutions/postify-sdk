import { describe, expect, it } from "vitest";
import { Postify } from "../client.js";
import { Page } from "../pagination.js";
import { jsonResponse, stubFetch } from "./helpers/fetch-stub.js";

function client(fetchImpl: typeof globalThis.fetch) {
  return new Postify({ apiKey: "postify_test_pagekey1234", fetch: fetchImpl });
}

const post = (id: string) => ({ id });

describe("cursor pagination: async iteration crosses pages, page escape hatch walks manually", () => {
  it("for-await over posts.list yields items from every page, passing next_cursor as after", async () => {
    const { fetchImpl, requests } = stubFetch([
      () =>
        jsonResponse(200, {
          data: [post("p1"), post("p2")],
          has_more: true,
          next_cursor: "cur_1",
        }),
      () =>
        jsonResponse(200, {
          data: [post("p3")],
          has_more: false,
          next_cursor: null,
        }),
    ]);
    const seen: string[] = [];
    for await (const p of client(fetchImpl).posts.list({
      limit: 2,
      status: "scheduled",
    })) {
      seen.push((p as { id: string }).id);
    }
    expect(seen).toEqual(["p1", "p2", "p3"]);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.url.searchParams.get("limit")).toBe("2");
    expect(requests[0]!.url.searchParams.get("status")).toBe("scheduled");
    expect(requests[0]!.url.searchParams.get("after")).toBeNull();
    // The follow-up request keeps the filter and adds the cursor.
    expect(requests[1]!.url.searchParams.get("after")).toBe("cur_1");
    expect(requests[1]!.url.searchParams.get("limit")).toBe("2");
    expect(requests[1]!.url.searchParams.get("status")).toBe("scheduled");
  });

  it("awaiting the list gives ONE page with getNextPage(), null on the last page", async () => {
    const { fetchImpl, requests } = stubFetch([
      () =>
        jsonResponse(200, {
          data: [post("m1")],
          has_more: true,
          next_cursor: "cur_media",
        }),
      () =>
        jsonResponse(200, {
          data: [post("m2")],
          has_more: false,
          next_cursor: null,
        }),
    ]);
    const page1 = await client(fetchImpl).media.list({ limit: 1 });
    expect(page1).toBeInstanceOf(Page);
    expect(page1.data).toHaveLength(1);
    expect(page1.has_more).toBe(true);
    expect(requests).toHaveLength(1);
    const page2 = await page1.getNextPage();
    expect(page2?.data.map((m) => (m as { id: string }).id)).toEqual(["m2"]);
    expect(await page2!.getNextPage()).toBeNull();
    expect(requests).toHaveLength(2);
  });

  it("a single-page list iterates exactly its own items and issues one request", async () => {
    const { fetchImpl, requests } = stubFetch([
      () =>
        jsonResponse(200, {
          data: [post("only")],
          has_more: false,
          next_cursor: null,
        }),
    ]);
    const seen: string[] = [];
    for await (const p of client(fetchImpl).posts.list()) {
      seen.push((p as { id: string }).id);
    }
    expect(seen).toEqual(["only"]);
    expect(requests).toHaveLength(1);
  });
});
