/**
 * Deterministic fetch stub for the SDK's unit suites: each handler serves one
 * request in order (the last handler repeats), and every request is recorded
 * for header/URL/body assertions.
 */

export interface RecordedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
}

export type StubHandler = (
  req: RecordedRequest,
) => Response | Promise<Response>;

export function stubFetch(handlers: StubHandler[]): {
  fetchImpl: typeof globalThis.fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const req: RecordedRequest = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    };
    requests.push(req);
    const handler =
      handlers[Math.min(requests.length - 1, handlers.length - 1)];
    if (!handler) throw new Error("stubFetch: no handler configured");
    return handler(req);
  }) as typeof globalThis.fetch;
  return { fetchImpl, requests };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type":
        status >= 400 ? "application/problem+json" : "application/json",
      "Request-Id": "req_test123",
      ...headers,
    },
  });
}

export function problemResponse(
  status: number,
  code: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return jsonResponse(
    status,
    {
      type: `https://usepostify.com/docs/api/problems/${code.replaceAll("_", "-")}`,
      title: `Problem ${code}`,
      status,
      code,
      request_id: "req_test123",
      ...extra,
    },
    headers,
  );
}
