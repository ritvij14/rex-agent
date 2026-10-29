import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import net from "node:net";
import dns from "node:dns";
import { unlinkSync } from "node:fs";
import { readFileSync } from "node:fs";

export interface ConnectorEndpoint {
  id?: string;
  socket: string;
  url: string;
  header?: string;
  env?: string;
  caEnv?: string;
  privateNetwork?: boolean;
  // Acceptance aid for in-process tests that bind real TLS on loopback.
  // Container acceptance never sets it; loopback stays denied in production.
  testAllowLoopback?: boolean;
}

interface ConnectorSpecFile {
  endpoints: ConnectorEndpoint[];
}

const FORWARD_HEADERS = [
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];
const METHODS = new Set(["POST", "GET", "DELETE"]);
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

export function connectAddressBlocked(
  ip: string,
  options: { privateNetwork?: boolean; testAllowLoopback?: boolean } = {},
): boolean {
  const version = net.isIP(ip);
  if (!version) return true;
  if (version === 6 && ip.toLowerCase().startsWith("::ffff:"))
    return connectAddressBlocked(ip.slice(7), options);
  if (version === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    if (a === 0 && b === 0) return true;
    if (a === 127) return !options.testAllowLoopback;
    if (a === 10) return !options.privateNetwork;
    if (a === 172 && b >= 16 && b <= 31) return !options.privateNetwork;
    if (a === 192 && b === 168) return !options.privateNetwork;
    if (a === 100 && b >= 64 && b <= 127) return !options.privateNetwork;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    return false;
  }
  const value = ip.toLowerCase();
  const first = Number.parseInt(value.split(":")[0] ?? "0", 16);
  if (value === "::") return true;
  if (value === "::1") return !options.testAllowLoopback;
  if ((first & 0xfe00) === 0xfc00) return !options.privateNetwork;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  return false;
}

interface PreparedEndpoint {
  url: URL;
  header?: string;
  credential?: string;
  ca?: Buffer;
  privateNetwork: boolean;
  testAllowLoopback: boolean;
}

function prepare(spec: ConnectorEndpoint): PreparedEndpoint {
  const url = new URL(spec.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname ||
    url.pathname === "/"
  ) {
    throw new Error("Refusing connector outside the fixed HTTPS origin.");
  }
  const credential = spec.env ? process.env[spec.env] : undefined;
  if (spec.env && !credential) {
    throw new Error("Connector credential environment variable is missing.");
  }
  const ca = spec.caEnv
    ? Buffer.from(
        process.env[spec.caEnv] ??
          (() => {
            throw new Error("Connector CA environment variable is missing.");
          })(),
      )
    : undefined;
  if (
    net.isIP(url.hostname) &&
    connectAddressBlocked(url.hostname, {
      privateNetwork: spec.privateNetwork === true,
      testAllowLoopback: spec.testAllowLoopback === true,
    })
  ) {
    throw new Error("Connector destination address is blocked.");
  }
  return {
    url: new URL(url.href),
    ...(spec.header && credential ? { header: spec.header, credential } : {}),
    ...(ca ? { ca } : {}),
    privateNetwork: spec.privateNetwork === true,
    testAllowLoopback: spec.testAllowLoopback === true,
  };
}

function harden(server: ReturnType<typeof createServer>) {
  server.headersTimeout = 10_000;
  server.requestTimeout = 0;
  server.maxHeadersCount = 32;
  return server;
}

function respond(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

export function startConnector(spec: ConnectorEndpoint): {
  close(): Promise<void>;
  path: string;
} {
  const endpoint = prepare(spec);
  const lookup = (
    hostname: string,
    _options: dns.LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error, "", 0);
      const list = addresses ?? [];
      if (
        !list.length ||
        list.some((address) => connectAddressBlocked(address.address, endpoint))
      ) {
        return callback(
          new Error("Connector destination address is blocked."),
          "",
          0,
        );
      }
      callback(
        null,
        _options.all
          ? list.map((address) => ({
              address: address.address,
              family: address.family,
            }))
          : (list[0]!.address as string),
        _options.all ? undefined : list[0]!.family,
      );
    });
  };
  const server = harden(
    createServer((req, res) => {
      if (req.url === "/health" && req.method === "GET") {
        res.end("ready");
        return;
      }
      if (!METHODS.has(req.method ?? "")) {
        req.resume();
        return respond(res, 405, "Connector method is not allowed.");
      }
      const headers: Record<string, string> = {};
      for (const name of FORWARD_HEADERS) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      if (endpoint.header && endpoint.credential) {
        headers[endpoint.header] = endpoint.credential;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) {
          req.destroy();
          respond(res, 413, "Connector request too large.");
        }
      });
      req.on("error", () => res.destroy());
      req.on("end", () => {
        if (size > MAX_REQUEST_BYTES) return;
        const body = Buffer.concat(chunks);
        if (req.method === "POST") {
          headers["content-length"] = String(body.length);
        }
        const options: RequestOptions = {
          hostname: endpoint.url.hostname,
          port: endpoint.url.port || "443",
          path: endpoint.url.pathname,
          method: req.method ?? "POST",
          headers,
          ...(endpoint.ca ? { ca: endpoint.ca } : {}),
          lookup,
          timeout: REQUEST_TIMEOUT_MS,
        };
        const outgoing = httpsRequest(options, (response) => {
          const status = response.statusCode ?? 502;
          if (status >= 300 && status < 400) {
            response.destroy();
            return respond(res, 502, "Remote MCP redirects are refused.");
          }
          const contentType = response.headers["content-type"];
          res.writeHead(status, {
            ...(contentType ? { "content-type": contentType } : {}),
          });
          let sent = 0;
          response.on("data", (chunk: Buffer) => {
            sent += chunk.length;
            if (sent > MAX_RESPONSE_BYTES) {
              response.destroy();
              outgoing.destroy();
              res.destroy();
            }
          });
          response.on("error", () => res.destroy());
          response.pipe(res);
        });
        outgoing.on("timeout", () => outgoing.destroy());
        outgoing.on("error", (error) => {
          respond(res, 502, "Remote MCP connection unavailable.");
        });
        res.on("close", () => outgoing.destroy());
        outgoing.end(body);
      });
    }),
  );
  try {
    unlinkSync(spec.socket);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  server.listen(spec.socket);
  return {
    path: spec.socket,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          try {
            unlinkSync(spec.socket);
          } catch {
            /* the socket may already be gone */
          }
          resolve();
        });
      }),
  };
}

export function startConnectors(specs: ConnectorEndpoint[]) {
  const servers = specs.map((spec) => startConnector(spec));
  return {
    paths: servers.map((server) => server.path),
    close: async () => {
      await Promise.all(servers.map((server) => server.close()));
    },
  };
}

if (process.argv[1]?.endsWith("connector.ts")) {
  if (process.argv[2]) {
    start(
      JSON.parse(readFileSync(process.argv[2], "utf8")) as ConnectorSpecFile,
    );
  } else {
    start(JSON.parse(readFileSync(0, "utf8")) as ConnectorSpecFile);
  }
}

function start(spec: ConnectorSpecFile) {
  if (!Array.isArray(spec.endpoints) || !spec.endpoints.length) {
    throw new Error("Connector specification requires endpoints.");
  }
  const running = startConnectors(spec.endpoints);
  process.on("SIGTERM", () => {
    void running.close().then(() => process.exit(0));
  });
}
