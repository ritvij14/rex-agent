import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import { runProfileRequest } from "@rex/pi-profiles";

async function setup(
  t: import("node:test").TestContext,
  handler: RequestListener,
) {
  const root = await mkdtemp(join(tmpdir(), "rex-profile-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of [
    "profiles/research",
    "state",
    "proposals",
    "workspace/.pi/extensions",
  ])
    await mkdir(join(root, dir), { recursive: true });
  await writeFile(
    join(root, "profiles/research/profile.json"),
    await readFile(
      new URL(
        "../../../lab/terminal/profiles/research/profile.json",
        import.meta.url,
      ),
    ),
  );
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    root,
    server,
    options: {
      profilesRoot: join(root, "profiles"),
      stateRoot: join(root, "state"),
      proposalsRoot: join(root, "proposals"),
      cwd: join(root, "workspace"),
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      input: "profile: research\nSynthetic task",
    },
  };
}

function stream(
  res: import("node:http").ServerResponse,
  tool = false,
  sequence = 0,
) {
  res.setHeader("content-type", "text/event-stream");
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `synthetic-${sequence}`,
            type: "function",
            function: { name: "ls", arguments: '{"path":"."}' },
          },
        ],
      }
    : { role: "assistant", content: "synthetic" };
  const chunk = {
    id: "synthetic",
    object: "chat.completion.chunk",
    model: "glm-5.3-flash-cloud",
    choices: [{ index: 0, delta, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
  );
}

test("project instructions and executable extensions are never inherited", async (t) => {
  const received: string[] = [];
  const f = await setup(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push(body);
    stream(res);
  });
  await writeFile(
    join(f.options.cwd, "SYSTEM.md"),
    "synthetic-untrusted-system-marker",
  );
  await writeFile(
    join(f.options.cwd, "AGENTS.md"),
    "synthetic-untrusted-agents-marker",
  );
  await writeFile(
    join(f.options.cwd, ".pi/extensions/untrusted.ts"),
    `throw new Error("synthetic-untrusted-extension-marker");`,
  );
  await mkdir(join(f.options.cwd, ".pi/skills/stray"), { recursive: true });
  await mkdir(join(f.options.cwd, ".pi/prompts"), { recursive: true });
  await writeFile(
    join(f.options.cwd, ".pi/skills/stray/SKILL.md"),
    "---\nname: stray\ndescription: synthetic-untrusted-skill-marker\n---\nNot selected.",
  );
  await writeFile(
    join(f.options.cwd, ".pi/prompts/stray.md"),
    "synthetic-untrusted-template-marker",
  );
  const result = await runProfileRequest({
    ...f.options,
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(result.output, "synthetic");
  assert.ok(!received.join("").includes("synthetic-untrusted"));
});

test("an aborted inference releases its profile lock", async (t) => {
  const f = await setup(t, (req) => {
    req.resume();
  });
  const seen = once(f.server, "request");
  const controller = new AbortController();
  const expected = new Error("synthetic cancellation");
  const result = assert.rejects(
    runProfileRequest({ ...f.options, signal: controller.signal }),
    (error) => error === expected,
  );
  await seen;
  controller.abort(expected);
  await result;
  assert.ok(
    !(await readdir(join(f.options.stateRoot, "research"))).includes(
      "turn.lock",
    ),
  );
});

test(
  "a repeated tool loop is bounded to twelve inference requests",
  { timeout: 15000 },
  async (t) => {
    let requests = 0;
    const f = await setup(t, (req, res) => {
      requests++;
      req.resume();
      stream(res, true, requests);
    });
    await assert.rejects(
      runProfileRequest({ ...f.options, signal: AbortSignal.timeout(10000) }),
      /limit reached/,
    );
    assert.equal(requests, 12);
    assert.ok(
      !(await readdir(join(f.options.stateRoot, "research"))).includes(
        "turn.lock",
      ),
    );
  },
);
