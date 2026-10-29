import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  connectAddressBlocked,
  startConnector,
  type ConnectorEndpoint,
} from "../lab/terminal/connector.ts";

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

async function fixture(
  t: TestContext,
  endpoint: ConnectorEndpoint,
  redirectOn = 3,
) {
  const root = await mkdtemp(join(tmpdir(), "rex-connector-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
    "-days",
    "2",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1,DNS:localhost",
    "-keyout",
    join(root, "key.pem"),
    "-out",
    join(root, "cert.pem"),
  ]);
  const key = await readFile(join(root, "key.pem"));
  const cert = await readFile(join(root, "cert.pem"));
  const requests: CapturedRequest[] = [];
  const server = https.createServer({ key, cert }, (req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: { ...req.headers } as Record<string, string>,
        body,
      });
      if (requests.length === redirectOn) {
        res.writeHead(302, { location: "http://127.0.0.1/" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end("REMOTE_REPLY");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  t.after(() => server.close());
  const certText = cert.toString();
  if (endpoint.caEnv) process.env[endpoint.caEnv] = certText;
  const socket = join(root, `${endpoint.id ?? "connector"}.sock`);
  const running = startConnector({
    ...endpoint,
    url: endpoint.url.replace("PORT", String(port)),
    socket,
  });
  t.after(() => running.close());
  return {
    requests,
    socket,
    async request(
      method: string,
      path: string,
      options: { headers?: Record<string, string>; body?: string } = {},
    ) {
      return new Promise<{
        status: number | undefined;
        headers: Record<string, string>;
        body: string;
      }>((resolve, reject) => {
        const outgoing = httpRequest(
          { socketPath: running.path, method, path, headers: options.headers },
          (response) => {
            let body = "";
            response.on("data", (chunk: Buffer) => {
              body += chunk.toString();
            });
            response.on("end", () =>
              resolve({
                status: response.statusCode,
                headers: response.headers as Record<string, string>,
                body,
              }),
            );
          },
        );
        outgoing.on("error", reject);
        outgoing.end(options.body);
      });
    },
  };
}

function baseEndpoint(
  overrides: Partial<ConnectorEndpoint> = {},
): ConnectorEndpoint {
  // Spreading a Partial over the defaults erases optionality in the type system only.
  return {
    id: "docs",
    url: "https://127.0.0.1:PORT/mcp",
    header: "X-Rex-Access",
    env: "REX_MCP_TEST_TOKEN",
    caEnv: "REX_MCP_TEST_CA",
    privateNetwork: false,
    testAllowLoopback: true,
    ...overrides,
  } as ConnectorEndpoint;
}

test("connector forwards fixed-target requests with injected credentials and strips caller auth", async (t) => {
  process.env.REX_MCP_TEST_TOKEN = "synthetic-connector-secret";
  const f = await fixture(t, baseEndpoint());
  // Request 1 provisions the fixture's redirect state; request 2 carries auth.
  await f.request("POST", "/mcp", { body: "{}" });
  assert.equal(f.requests.length, 1);
  const response = await f.request("POST", "/ignored", {
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-session-id": "synthetic-session",
      authorization: "Bearer caller-secret",
      cookie: "session=caller-cookie",
    },
    body: "synthetic-body",
  });
  const seen = f.requests.at(-1)!;
  assert.equal(seen.method, "POST");
  assert.equal(seen.url, "/mcp");
  assert.equal(seen.headers["x-rex-access"], "synthetic-connector-secret");
  assert.equal(seen.headers["authorization"], undefined);
  assert.equal(seen.headers["cookie"], undefined);
  assert.equal(seen.headers["mcp-session-id"], "synthetic-session");
  assert.equal(seen.body, "synthetic-body");
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "text/event-stream");
  assert.equal(response.body, "REMOTE_REPLY");
});

test("connector refuses redirects, unsupported methods and never follows them", async (t) => {
  process.env.REX_MCP_TEST_TOKEN = "synthetic-connector-secret";
  const f = await fixture(t, baseEndpoint(), 1);
  const redirected = await f.request("POST", "/mcp", { body: "{}" });
  assert.equal(redirected.status, 502);
  assert.equal(f.requests.length, 1);
  const method = await f.request("PUT", "/mcp");
  assert.equal(method.status, 405);
  assert.deepEqual((await f.request("GET", "/health")).body, "ready");
  assert.equal(f.requests.length, 1);
});

test("connector denies loopback, link-local and private ranges by policy", async (t) => {
  assert.ok(connectAddressBlocked("127.0.0.1"));
  assert.ok(connectAddressBlocked("127.8.9.10"));
  assert.ok(connectAddressBlocked("::1"));
  assert.ok(connectAddressBlocked("::ffff:127.0.0.1"));
  assert.ok(connectAddressBlocked("0.0.0.0"));
  assert.ok(connectAddressBlocked("169.254.169.254"));
  assert.ok(connectAddressBlocked("224.0.0.1"));
  assert.ok(connectAddressBlocked("ff02::1"));
  assert.ok(connectAddressBlocked("not-an-ip"));
  for (const ip of [
    "10.1.2.3",
    "172.16.0.9",
    "192.168.1.4",
    "100.64.0.2",
    "fd00::5",
  ]) {
    assert.ok(connectAddressBlocked(ip));
    assert.ok(!connectAddressBlocked(ip, { privateNetwork: true }));
  }
  assert.ok(!connectAddressBlocked("8.8.8.8"));
  assert.ok(!connectAddressBlocked("127.0.0.1", { testAllowLoopback: true }));
  process.env.REX_MCP_TEST_TOKEN = "synthetic-connector-secret";
  await assert.rejects(
    fixture(t, baseEndpoint({ testAllowLoopback: false })),
    /blocked/,
  );
  // Hostnames are checked per connection, so a rebinding attempt fails at request time.
  const resolver = await fixture(
    t,
    baseEndpoint({
      testAllowLoopback: true,
      url: "https://localhost:PORT/mcp",
    }),
  );
  const blocked = await resolver.request("POST", "/mcp", { body: "{}" });
  assert.equal(blocked.status, 502);
  assert.equal(resolver.requests.length, 0);
});

test("connector rejects untrusted certificates and unreachable destinations once", async (t) => {
  process.env.REX_MCP_TEST_TOKEN = "synthetic-connector-secret";
  const untrusted = await fixture(
    t,
    baseEndpoint({ id: "no-ca", caEnv: undefined }),
  );
  const failure = await untrusted.request("POST", "/mcp", { body: "{}" });
  assert.equal(failure.status, 502);
  assert.equal(untrusted.requests.length, 0);
  const outage = await fixture(
    t,
    baseEndpoint({ id: "dead", url: "https://127.0.0.1:1/mcp" }),
  );
  const refused = await outage.request("POST", "/mcp", { body: "{}" });
  assert.equal(refused.status, 502);
  // The caller may repeat after a failed turn; the connector never retries internally.
  const again = await outage.request("POST", "/mcp", { body: "{}" });
  assert.equal(again.status, 502);
});

test("connector startup requires declared credential environment values", async (t) => {
  delete process.env.REX_MCP_MISSING_TOKEN;
  assert.throws(() =>
    startConnector({
      id: "missing",
      socket: join(tmpdir(), "rex-missing.sock"),
      url: "https://mcp.example.test/mcp",
      env: "REX_MCP_MISSING_TOKEN",
    }),
  );
});
