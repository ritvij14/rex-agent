import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lookupProfile } from "@rex/profiles";
import {
  IncompleteProfileResponseError,
  runProfileRequest,
  createProposal,
} from "./index.ts";

async function verifyResponses() {
  const root = await mkdtemp(join(tmpdir(), "rex-response-check-"));
  let response: "length" | "stop" | "tool" = "length";
  let requests = 0;
  let capFree = true;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    requests++;
    capFree &&=
      !Object.hasOwn(payload, "max_tokens") &&
      !Object.hasOwn(payload, "max_completion_tokens");
    const delta =
      response === "tool"
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "synthetic-partial-call",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({
                    path: "must-not-exist.txt",
                    content: "synthetic",
                  }),
                },
              },
            ],
          }
        : { role: "assistant", content: "synthetic" };
    const chunk = {
      id: "synthetic",
      object: "chat.completion.chunk",
      model: payload.model,
      choices: [{ index: 0, delta, finish_reason: null }],
    };
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end(
      `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: response === "stop" ? "stop" : "length" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    for (const name of ["state", "proposals", "workspace"])
      await mkdir(join(root, name));
    const options = {
      profilesRoot: "/profiles",
      stateRoot: join(root, "state"),
      proposalsRoot: join(root, "proposals"),
      cwd: join(root, "workspace"),
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      signal: AbortSignal.timeout(20000),
    };
    for (const id of ["coding", "research", "profile-builder"]) {
      response = "length";
      const before = requests;
      await assert.rejects(
        runProfileRequest({
          ...options,
          input: `profile: ${id}\nSynthetic response check`,
        }),
        IncompleteProfileResponseError,
      );
      assert.equal(requests, before + 1);
      await assert.rejects(access(join(options.stateRoot, id, "turn.lock")));
      response = "stop";
      assert.equal(
        (
          await runProfileRequest({
            ...options,
            input: `profile: ${id}\nResume synthetic response check`,
          })
        ).output,
        "synthetic",
      );
    }
    response = "tool";
    const before = requests;
    await assert.rejects(
      runProfileRequest({
        ...options,
        input: "profile: coding\nSynthetic partial tool check",
      }),
      IncompleteProfileResponseError,
    );
    assert.equal(requests, before + 1);
    assert.deepEqual(await readdir(options.cwd), []);
    assert.equal(capFree, true);
    console.log(
      "PASS: installed adapter rejects truncated text/tools, releases locks, resumes and sends no output cap; synthetic loopback only.",
    );
  } finally {
    server.closeAllConnections();
    server.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv[2] === "responses") {
    await verifyResponses();
    return;
  }
  if (process.argv[2] === "approved") {
    assert.equal(
      (await lookupProfile("/profiles", "synthetic-helper")).configuration
        ?.model.id,
      "glm-5.3-flash-cloud",
    );
    console.log("PASS: operator-approved synthetic profile is available.");
    return;
  }
  const options = {
    profilesRoot: "/profiles",
    stateRoot: "/state/profiles",
    proposalsRoot: "/proposals",
    cwd: "/workspace",
    baseUrl: "http://127.0.0.1:8317/v1",
  };
  assert.deepEqual((await readdir("/profiles")).sort(), [
    "coding",
    "profile-builder",
    "research",
  ]);
  await assert.rejects(writeFile("/profiles/forbidden", "synthetic"));
  await assert.rejects(
    runProfileRequest({ ...options, input: "Missing profile selector" }),
  );
  for (const id of ["coding", "research", "profile-builder"]) {
    const result = await runProfileRequest({
      ...options,
      input: `profile: ${id}\nReply with synthetic.`,
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(result.profileId, id);
    assert.equal(result.model, "glm-5.3-flash-cloud");
    assert.equal(result.output, "synthetic");
  }
  for (const path of [
    "/opt/rex/packages/profiles/AGENTS.md",
    "/opt/rex/packages/profiles/tests",
    "/opt/rex/packages/pi-profiles/AGENTS.md",
    "/opt/rex/packages/pi-profiles/tests",
  ]) {
    await assert.rejects(access(path));
  }
  const cli = spawnSync(
    "/usr/local/bin/rex",
    ["--new-session", "profile: research\nsynthetic-cap-free-response"],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /profile=research model=glm-5.3-flash-cloud/);
  assert.match(cli.stdout, /synthetic/);
  const truncated = spawnSync(
    "/usr/local/bin/rex",
    ["--new-session", "profile: research\nsynthetic-truncated-response"],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(truncated.status, 1);
  assert.equal(truncated.stdout, "");
  assert.match(truncated.stderr, /truncated.*output limit/i);
  assert.ok(!truncated.stderr.includes("synthetic-private-partial"));
  const recovered = spawnSync(
    "/usr/local/bin/rex",
    ["profile: research\nsynthetic-cap-free-response"],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(recovered.status, 0);
  assert.match(recovered.stdout, /synthetic/);
  assert.equal(
    spawnSync("/usr/local/bin/rex", ["No profile selector"], { stdio: "pipe" })
      .status,
    1,
  );
  const denied = spawnSync(
    process.execPath,
    [
      "--import",
      "/opt/rex/node_modules/tsx/dist/loader.mjs",
      "/opt/rex/packages/pi-profiles/src/operator.ts",
      "approve",
      "synthetic-helper",
      "0".repeat(64),
    ],
    { stdio: "pipe" },
  );
  assert.equal(denied.status, 1);
  const proposal = await createProposal(
    "/profiles",
    "/proposals",
    {
      id: "synthetic-helper",
      configuration: {
        instructions: "A synthetic test helper.",
        model: { provider: "cli-proxy", id: "glm-5.3-flash-cloud" },
        tools: { whitelist: ["read"], blacklist: ["bash"] },
      },
    },
    { operation: "create", origin: "profile-builder" },
  );
  await assert.rejects(lookupProfile("/profiles", proposal.id));
  await writeFile("/state/synthetic-proposal-digest.txt", proposal.digest);
  console.log(
    "PASS: installed profile SDK, three synthetic role/model runs, selector rejection, read-only definitions and operator-only activation.",
  );
}

main().catch(() => {
  console.error(
    "FAIL: synthetic profile container acceptance; private diagnostics omitted.",
  );
  process.exitCode = 1;
});
