// A synthetic stand-in for the FastAPI backend, for browser tests and baseline
// screenshots that need specific API answers (an upload failure, an empty
// import list, a request that never answers). It holds no data of its own:
// every answer comes from the `respond` callback. CORS is open to any origin
// because it only ever serves throwaway test frontends on 127.0.0.1.

import { createServer } from "node:http";
import { freePort } from "./frontend-server.mjs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST",
};

/** A JSON answer for `respond`: `{ status, body }`. */
export function json(status, body) {
  return { status, body };
}

/** The API's error format for `code`, as `respond` returns it. */
export function apiError(status, code, message = `Synthetic ${code}.`) {
  return json(status, { error: { code, message } });
}

/**
 * Start the fake API on a free port. `respond({ method, path, query })` gets
 * the request's method, URL path and query parameters (URLSearchParams) and
 * returns `{ status, body }`, or null to leave the request unanswered (a
 * request that hangs, for loading states). Preflight requests are answered
 * automatically. Resolves to { origin, close() }; close() also drops hanging
 * requests.
 */
export async function startFakeApi(respond) {
  const hanging = new Set();
  const server = createServer((request, response) => {
    request.resume();
    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return;
    }
    const url = new URL(request.url, "http://fake");
    const answer = respond({ method: request.method, path: url.pathname, query: url.searchParams });
    if (answer === null) {
      hanging.add(response);
      return;
    }
    response.writeHead(answer.status, { ...CORS_HEADERS, "Content-Type": "application/json" });
    response.end(JSON.stringify(answer.body));
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${port}`,
    close() {
      for (const response of hanging) response.destroy();
      server.close();
    },
  };
}
