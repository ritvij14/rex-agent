import {
  createServer,
  request,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export const MAX_BODY_BYTES = 4 * 1024 * 1024;
const REQUEST_HEADERS = [
  "content-type",
  "accept",
  "anthropic-version",
  "anthropic-beta",
  "openai-beta",
];
const ROUTES = new Set([
  "POST /v1/chat/completions",
  "POST /v1/responses",
  "POST /v1/messages",
  "POST /v1/messages?beta=true",
  "GET /v1/models",
]);

function fail(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

function forward(
  req: IncomingMessage,
  res: ServerResponse,
  destination: { socketPath: string } | { hostname: string; port: string },
  headers: Record<string, string>,
  body?: Buffer,
) {
  const outgoing = request(
    {
      ...destination,
      path: req.url,
      method: req.method,
      headers,
      timeout: 300_000,
    },
    (response) => {
      const status = response.statusCode ?? 502;
      if (status < 200 || status >= 300) {
        response.destroy();
        fail(res, status >= 400 ? status : 502, "Inference request rejected");
        return;
      }
      res.writeHead(status, {
        "content-type": response.headers["content-type"] ?? "application/json",
      });
      response.on("error", () => res.destroy());
      response.pipe(res);
    },
  );
  outgoing.on("timeout", () => outgoing.destroy());
  outgoing.on("error", () =>
    fail(res, 502, "Inference connection unavailable"),
  );
  res.on("close", () => outgoing.destroy());
  if (body) outgoing.end(body);
  else req.pipe(outgoing);
}

function harden(server: ReturnType<typeof createServer>) {
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.maxHeadersCount = 32;
  server.on("connect", (_req, socket) =>
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"),
  );
  server.on("upgrade", (_req, socket) =>
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"),
  );
  server.on("clientError", (_error, socket) =>
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"),
  );
  return server;
}

export function createGateway(options: { upstream: URL; apiKey?: string }) {
  const { upstream, apiKey } = options;
  if (
    upstream.protocol !== "http:" ||
    upstream.username ||
    upstream.password ||
    upstream.pathname !== "/" ||
    upstream.search ||
    upstream.hash
  ) {
    throw new Error("Expected one credential-free HTTP proxy origin");
  }
  let active = 0;
  return harden(
    createServer(async (req, res) => {
      if (!ROUTES.has(`${req.method} ${req.url}`)) {
        req.resume();
        return fail(res, 403, "Inference operation not allowed");
      }
      if (active >= 2) {
        req.resume();
        return fail(res, 429, "Inference concurrency limit reached");
      }
      active++;
      res.once("close", () => {
        active--;
      });
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            fail(res, 413, "Inference request too large");
            return;
          }
          chunks.push(Buffer.from(chunk));
        }
      } catch {
        return fail(res, 400, "Invalid inference request");
      }
      const body = Buffer.concat(chunks);
      if (req.method === "POST") {
        if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
          return fail(res, 415, "Expected JSON inference request");
        }
        try {
          const parsed: unknown = JSON.parse(body.toString("utf8"));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error();
        } catch {
          return fail(res, 400, "Invalid inference JSON");
        }
      } else if (size) {
        return fail(res, 400, "Unexpected request body");
      }
      const headers: Record<string, string> = {};
      for (const name of REQUEST_HEADERS) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      headers["content-length"] = String(body.length);
      forward(
        req,
        res,
        { hostname: upstream.hostname, port: upstream.port || "80" },
        headers,
        body,
      );
    }),
  );
}

export function createRelay(socketPath: string) {
  return harden(
    createServer((req, res) => {
      if (req.url === "/health" && req.method === "GET") {
        res.end("ready");
        return;
      }
      const headers: Record<string, string> = {};
      for (const name of REQUEST_HEADERS) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      forward(req, res, { socketPath }, headers);
    }),
  );
}
