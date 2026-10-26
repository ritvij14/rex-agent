import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  operatorProposalVolume,
  withProfileLock,
  workerVolumes,
} from "../scripts/profile-worker.ts";
import { ROOT } from "../scripts/repo-check.ts";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import {
  main as sandboxMain,
  parseRexInput,
  workerDockerArgs,
} from "../scripts/sandbox.ts";
import { captureLogs } from "./helpers.ts";
import { test, type TestContext } from "node:test";
import {
  createGateway,
  createRelay,
  MAX_BODY_BYTES,
} from "../lab/terminal/transport.ts";
import { modelConfiguration } from "../lab/terminal/configure.ts";

async function listen(t: TestContext, server: Server, socket?: string) {
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  if (socket) server.listen(socket);
  else server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return typeof address === "object" && address
    ? `http://127.0.0.1:${address.port}`
    : "";
}

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "rex-gateway-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const received: {
    path: string;
    headers: NodeJS.Dict<string | string[]>;
    body: string;
  }[] = [];
  let status = 200;
  const upstream = await listen(
    t,
    createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      received.push({ path: req.url!, headers: req.headers, body });
      res.writeHead(status, {
        "content-type": "text/event-stream",
        "set-cookie": "synthetic-cookie=not-forwarded",
        location: "http://example.com/not-followed",
      });
      res.write("data: synthetic\n\n");
      res.end("data: [DONE]\n\n");
    }),
  );
  const socket = join(directory, "inference.sock");
  const key = "synthetic-inference-credential";
  const gateway = createGateway({ upstream: new URL(upstream), apiKey: key });
  await listen(t, gateway, socket);
  const relay = await listen(t, createRelay(socket));
  return {
    relay,
    received,
    key,
    upstream,
    setStatus: (value: number) => {
      status = value;
    },
  };
}

function raw(
  url: string,
  path: string,
  method = "POST",
  body = method === "POST" ? "{}" : "",
  headers = {},
) {
  return new Promise<{
    status: number;
    body: string;
    headers: NodeJS.Dict<string | string[]>;
  }>((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        path,
        headers: { "content-type": "application/json", ...headers },
      },
      (res) => {
        let output = "";
        res.on("data", (chunk) => {
          output += chunk;
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            body: output,
            headers: res.headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("gateway streams inference and replaces credentials without forwarding cookies", async (t) => {
  const f = await fixture(t);
  const result = await raw(
    f.relay,
    "/v1/chat/completions",
    "POST",
    '{"model":"synthetic-model"}',
    {
      authorization: "Bearer client-controlled",
      "x-api-key": "client-controlled",
      "x-management-key": "client-controlled",
      "x-forwarded-for": "127.0.0.1",
      "anthropic-version": "2023-06-01",
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body, "data: synthetic\n\ndata: [DONE]\n\n");
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(result.headers.location, undefined);
  assert.equal(f.received.length, 1);
  assert.equal(f.received[0]!.headers.authorization, `Bearer ${f.key}`);
  for (const name of ["x-api-key", "x-management-key", "x-forwarded-for"]) {
    assert.equal(f.received[0]!.headers[name], undefined);
  }
  assert.equal(f.received[0]!.headers["anthropic-version"], "2023-06-01");
  assert.equal(result.body.includes(f.key), false);
});

test("gateway rejects management, URL tricks, unknown methods and queries before upstream access", async (t) => {
  const f = await fixture(t);
  for (const [method, path] of [
    ["GET", "/v0/management/config"],
    ["GET", "/v8/management/config"],
    ["POST", "/v1/../v0/management/config"],
    ["POST", "/v1/%2e%2e/v0/management/config"],
    ["POST", "/v1/chat/completions?url=http://example.com"],
    ["POST", "http://example.com/v1/chat/completions"],
    ["GET", "/v1/responses/synthetic-response"],
    ["DELETE", "/v1/models"],
    ["POST", "/v1/chat/completions/"],
    ["POST", "/login"],
  ]) {
    assert.equal(
      (await raw(f.relay, path!, method!)).status,
      403,
      `${method} ${path}`,
    );
  }
  assert.equal(f.received.length, 0);
});

test("gateway supports only the declared model listing and inference protocols", async (t) => {
  const f = await fixture(t);
  assert.equal((await raw(f.relay, "/v1/models", "GET", "")).status, 200);
  for (const path of [
    "/v1/chat/completions",
    "/v1/responses",
    "/v1/messages",
    "/v1/messages?beta=true",
  ]) {
    assert.equal((await raw(f.relay, path)).status, 200);
  }
  assert.equal(f.received.length, 5);
});

test("gateway bounds and validates JSON bodies without sending rejected data", async (t) => {
  const f = await fixture(t);
  for (const body of ["not JSON", "null", "[]"]) {
    assert.equal(
      (await raw(f.relay, "/v1/responses", "POST", body)).status,
      400,
    );
  }
  assert.equal(
    (
      await raw(f.relay, "/v1/responses", "POST", "{}", {
        "content-type": "text/plain",
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await raw(
        f.relay,
        "/v1/responses",
        "POST",
        '"' + "a".repeat(MAX_BODY_BYTES) + '"',
      )
    ).status,
    413,
  );
  assert.equal(f.received.length, 0);
});

test("upstream redirects and error bodies are not forwarded or retried", async (t) => {
  const f = await fixture(t);
  for (const status of [302, 401, 429, 500]) {
    f.setStatus(status);
    const result = await raw(f.relay, "/v1/responses");
    assert.equal(result.status, status === 302 ? 502 : status);
    assert.equal(result.headers.location, undefined);
    assert.equal(result.body.includes("synthetic"), false);
  }
  assert.equal(f.received.length, 4);
});

test("missing gateway or upstream fails closed with redacted errors", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rex-missing-gateway-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const relay = await listen(t, createRelay(join(directory, "absent.sock")));
  assert.deepEqual(
    await raw(relay, "/v1/models", "GET", "").then(({ status, body }) => ({
      status,
      body,
    })),
    {
      status: 502,
      body: '{"error":"Inference connection unavailable"}',
    },
  );
  const upstream = createServer();
  const origin = await listen(t, upstream);
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  const gateway = await listen(t, createGateway({ upstream: new URL(origin) }));
  const result = await raw(gateway, "/v1/responses");
  assert.equal(result.status, 502);
  assert.equal(result.body.includes(origin), false);
});

test("gateway refuses CONNECT and WebSocket tunnels before upstream access", async (t) => {
  const f = await fixture(t);
  const gateway = await listen(
    t,
    createGateway({ upstream: new URL(f.upstream) }),
  );
  const address = new URL(gateway);
  for (const input of [
    "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n",
    "GET /v1/models HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
  ]) {
    const output = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(address.port), address.hostname, () =>
        socket.write(input),
      );
      let result = "";
      socket.on("data", (chunk) => {
        result += chunk;
      });
      socket.on("end", () => resolve(result));
      socket.on("error", reject);
    });
    assert.match(output, /^HTTP\/1.1 403/);
  }
  assert.equal(f.received.length, 0);
});

test("gateway limits concurrent inference and releases completed slots", async (t) => {
  const held: import("node:http").ServerResponse[] = [];
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = true;
  const origin = await listen(
    t,
    createServer((req, res) => {
      req.resume();
      if (!hold) return res.end("done");
      held.push(res);
      if (held.length === 2) release();
    }),
  );
  const gateway = await listen(t, createGateway({ upstream: new URL(origin) }));
  const pending = [
    raw(gateway, "/v1/responses"),
    raw(gateway, "/v1/responses"),
  ];
  await ready;
  assert.equal((await raw(gateway, "/v1/responses")).status, 429);
  hold = false;
  for (const res of held) res.end("done");
  assert.equal(
    (await Promise.all(pending)).every((result) => result.status === 200),
    true,
  );
  assert.equal((await raw(gateway, "/v1/responses")).status, 200);
});

test("sandbox build context permits only named public runtime files", () => {
  const rules = readFileSync(join(ROOT, "lab/terminal/.dockerignore"), "utf8")
    .trim()
    .split("\n");
  assert.deepEqual(rules, [
    "*",
    "!Dockerfile",
    "!package.json",
    "!package-lock.json",
    "!transport.ts",
    "!configure.ts",
    "!runtime.ts",
    "!verify.ts",
    "!provision.ts",
    "!pi.sh",
    "!profiles/",
    "!profiles/coding/",
    "!profiles/coding/profile.json",
    "!profiles/research/",
    "!profiles/research/profile.json",
    "!profiles/qa/",
    "!profiles/qa/profile.json",
    "!profiles/profile-builder/",
    "!profiles/profile-builder/profile.json",
  ]);
  for (const [name, files] of [
    ["profiles", ["index.ts", "configuration.ts", "errors.ts"]],
    [
      "pi-profiles",
      [
        "index.ts",
        "policy.ts",
        "proposals.ts",
        "cli.ts",
        "operator.ts",
        "verify.ts",
      ],
    ],
  ] as const) {
    assert.deepEqual(
      readFileSync(join(ROOT, "packages", name, ".dockerignore"), "utf8")
        .trim()
        .split("\n"),
      ["*", "!package.json", "!src/", ...files.map((file) => `!src/${file}`)],
    );
  }
});

test("rex input parsing stays explicit, bounded and option-safe", () => {
  assert.deepEqual(parseRexInput([]), {
    newSession: false,
    maintain: false,
    input: null,
  });
  assert.deepEqual(parseRexInput(["--new-session"]), {
    newSession: true,
    maintain: false,
    input: null,
  });
  assert.deepEqual(parseRexInput(["--maintain", "--new-session"]), {
    newSession: true,
    maintain: true,
    input: null,
  });
  assert.deepEqual(
    parseRexInput(["--new-session", "--maintain", "profile: coding\nHi"]),
    {
      newSession: true,
      maintain: true,
      input: "profile: coding\nHi",
    },
  );
  assert.throws(() => parseRexInput(["a", "b"]));
  assert.throws(() => parseRexInput(["--new-session", "--more"]));
  assert.throws(() => parseRexInput(["--maintain", "--maintain"]));
});

test("update approval reads only the target profile draft volume", () => {
  const coding = workerVolumes("rex-check", "coding").proposals;
  const builder = workerVolumes("rex-check", "profile-builder").proposals;
  assert.equal(
    operatorProposalVolume("rex-check", "approve-update", "coding"),
    coding,
  );
  assert.notEqual(
    operatorProposalVolume("rex-check", "approve-update", "coding"),
    builder,
  );
  assert.equal(
    operatorProposalVolume("rex-check", "approve", "synthetic-helper"),
    builder,
  );
});

test("worker launchers are isolated by construction", () => {
  const args = workerDockerArgs({
    project: "rex-check",
    image: "rex-image",
    profile: "coding",
    volumes: {
      workspace: "rex-check_workspace",
      state: "rex-check_state",
      proposals: "rex-check_proposals",
      defs: "rex-check_defs",
      socket: "rex-check_inference-socket",
    },
    name: "rex-check-worker-1",
  });
  assert.equal(args[0], "run");
  for (const flag of [
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--security-opt",
    "no-new-privileges:true",
    "--cap-drop",
    "ALL",
    "--init",
    "--user",
    "1000:1000",
    "--pids-limit",
    "128",
    "--memory",
    "1g",
    "--cpus",
    "2",
  ]) {
    assert.ok(args.includes(flag), flag);
  }
  const mounts: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "-v") mounts.push(args[index + 1]!);
  }
  assert.equal(mounts.length, 5, mounts.join(","));
  for (const mount of mounts) {
    assert.equal(mount.startsWith("/") || mount.startsWith("~"), false, mount);
  }
  assert.ok(mounts.includes("rex-check_defs:/profiles:ro,nocopy"), "defs ro");
  assert.ok(
    mounts.includes("rex-check_inference-socket:/run/rex:ro"),
    "socket ro",
  );
  assert.ok(mounts.includes("rex-check_workspace:/workspace"));
  assert.ok(mounts.includes("rex-check_state:/state"));
  assert.ok(mounts.includes("rex-check_proposals:/proposals"));
  assert.equal(
    mounts.some(
      (mount) =>
        mount.includes("docker.sock") || mount === "/var/run/docker.sock",
    ),
    false,
  );
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--tmpfs") {
      assert.match(args[index + 1]!, /noexec.*nosuid/);
    }
  }
  assert.ok(args.includes("rex-image"));
  assert.ok(args.includes("rex-check-worker-1"));
  const imageIndex = args.indexOf("rex-image");
  assert.equal(args[imageIndex + 1], "node");
});

test("sandbox CLI rejects unknown actions and unconfirmed reset without invoking Docker", () => {
  for (const args of [
    [],
    ["unknown"],
    ["reset"],
    ["reset", "--confirm", "extra"],
    ["start", "extra"],
    ["refresh", "extra"],
    ["review-profile", "../invalid"],
    ["approve-profile", "coding", "invalid-digest"],
    ["approve-update", "coding", "invalid-digest"],
  ]) {
    assert.equal(captureLogs(() => sandboxMain(args)).result, 1);
  }
});

test("model configuration permits only supported protocols and literal model IDs", () => {
  const config = modelConfiguration("synthetic-model", "openai-completions");
  assert.equal(
    config.providers["cli-proxy"].baseUrl,
    "http://127.0.0.1:8317/v1",
  );
  assert.equal(config.providers["cli-proxy"].models[0]!.id, "synthetic-model");
  assert.throws(() =>
    modelConfiguration("!execute-something", "openai-completions"),
  );
  assert.throws(() => modelConfiguration("synthetic-model", "unknown"));
  assert.throws(() => modelConfiguration("", "openai-completions"));
  assert.throws(() =>
    modelConfiguration("synthetic-model\n", "anthropic-messages"),
  );
  assert.equal(
    modelConfiguration("synthetic-model", "anthropic-messages").providers[
      "cli-proxy"
    ].baseUrl,
    "http://127.0.0.1:8317",
  );
});

test("a held operator lock rejects work without deleting the existing lock", () => {
  const project = `rex-lock-${randomUUID()}`;
  const path = join(tmpdir(), `${project}-rex-coding.lock`);
  writeFileSync(path, "synthetic lock owner", { flag: "wx", mode: 0o600 });
  let called = false;
  try {
    assert.throws(
      () =>
        withProfileLock(project, "coding", () => {
          called = true;
        }),
      /busy/,
    );
    assert.equal(called, false);
    assert.equal(readFileSync(path, "utf8"), "synthetic lock owner");
  } finally {
    rmSync(path);
  }
});
