import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { lookupProfile, ProfileError } from "@rex/profiles";
import {
  runProfileRequest,
  createProposal,
  reviewProposal,
  approveProposal,
} from "@rex/pi-profiles";

type Reply =
  | { text: string; finish?: "length" }
  | { tool: string; args: unknown; finish?: "length" }
  | { status: number };
interface WireRequest {
  model: string;
  messages: { role: string; content: unknown }[];
  tools?: { function: { name: string } }[];
  max_tokens?: number;
  max_completion_tokens?: number;
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "rex-pi-profile-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profilesRoot = join(root, "profiles");
  const stateRoot = join(root, "state");
  const proposalsRoot = join(root, "proposals");
  const cwd = join(root, "workspace");
  for (const path of [profilesRoot, stateRoot, proposalsRoot, cwd])
    await mkdir(path);
  for (const id of ["coding", "research", "profile-builder"]) {
    await mkdir(join(profilesRoot, id));
    const content = await readFile(
      new URL(
        `../../../lab/terminal/profiles/${id}/profile.json`,
        import.meta.url,
      ),
    );
    await writeFile(join(profilesRoot, id, "profile.json"), content);
  }
  const replies: Reply[] = [];
  const received: WireRequest[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body));
    const reply = replies.shift() ?? { text: "synthetic done" };
    if ("status" in reply) {
      res.writeHead(reply.status);
      res.end('{"error":"synthetic-private-provider-error"}');
      return;
    }
    res.setHeader("content-type", "text/event-stream");
    const delta =
      "text" in reply
        ? { role: "assistant", content: reply.text }
        : {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `synthetic-call-${received.length}`,
                type: "function",
                function: {
                  name: reply.tool,
                  arguments: JSON.stringify(reply.args),
                },
              },
            ],
          };
    const chunk = {
      id: "synthetic-response",
      object: "chat.completion.chunk",
      model: "glm-5.3-flash-cloud",
      choices: [{ index: 0, delta, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end(
      `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: reply.finish ?? ("text" in reply ? "stop" : "tool_calls") }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const options = {
    profilesRoot,
    stateRoot,
    proposalsRoot,
    cwd,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  };
  return {
    ...options,
    received,
    replies,
    run: (id: string, prompt = "Synthetic task", newSession = false) =>
      runProfileRequest({
        ...options,
        input: `profile: ${id}\n${prompt}`,
        newSession,
        signal: AbortSignal.timeout(10000),
      }),
  };
}

function draft(id = "synthetic-helper") {
  return {
    id,
    configuration: {
      instructions: "A synthetic helper.",
      model: { provider: "cli-proxy", id: "glm-5.3-flash-cloud" },
      tools: { whitelist: ["read"], blacklist: ["bash"] },
    },
  };
}

test("all three profiles load their role, fixed GLM model and permitted tools", async (t) => {
  const f = await fixture(t);
  for (const id of ["coding", "research", "profile-builder"]) {
    const result = await f.run(id);
    assert.equal(result.profileId, id);
    assert.equal(result.model, "glm-5.3-flash-cloud");
    assert.equal(result.output, "synthetic done");
    const request = f.received.at(-1)!;
    assert.equal(request.model, "glm-5.3-flash-cloud");
    assert.ok(JSON.stringify(request.messages).includes(`the ${id} profile`));
    const tools = request.tools?.map((tool) => tool.function.name) ?? [];
    assert.deepEqual(tools.sort(), [...result.toolNames].sort());
    assert.equal(tools.includes("write"), id === "coding");
    assert.equal(tools.includes("propose_profile"), id === "profile-builder");
    assert.equal(tools.includes("codemode"), false);
  }
});

test("profile requests leave output-token limits to the provider", async (t) => {
  const f = await fixture(t);
  const answer = `${"synthetic ".repeat(1600)}complete`;
  for (const id of ["coding", "research", "profile-builder"]) {
    f.replies.push({ text: answer });
    const result = await f.run(id);
    const request = f.received.at(-1)!;
    assert.equal(Object.hasOwn(request, "max_tokens"), false);
    assert.equal(Object.hasOwn(request, "max_completion_tokens"), false);
    assert.equal(result.output, answer);
  }
});

test("missing/unknown selectors and unsupported tools fail before inference", async (t) => {
  const f = await fixture(t);
  for (const input of [
    "Use coding",
    "profile: missing\nTask",
    "profile: ../coding\nTask",
  ]) {
    await assert.rejects(runProfileRequest({ ...f, input }));
  }
  const file = join(f.profilesRoot, "coding", "profile.json");
  const config = JSON.parse(await readFile(file, "utf8"));
  config.configuration.tools.blacklist = ["unknown_tool"];
  await writeFile(file, JSON.stringify(config));
  await assert.rejects(f.run("coding"), /not supported/);
  assert.equal(f.received.length, 0);
});

test("forced denied write and bash calls cannot produce side effects", async (t) => {
  const f = await fixture(t);
  f.replies.push(
    {
      tool: "write",
      args: { path: "forbidden.txt", content: "must not exist" },
    },
    { tool: "bash", args: { command: "printf denied > forbidden.txt" } },
    { text: "denied" },
  );
  const result = await f.run("research");
  assert.equal(result.output, "denied");
  assert.deepEqual(await readdir(f.cwd), []);
  const toolMessages = f.received.flatMap((req) =>
    req.messages.filter((message) => message.role === "tool"),
  );
  assert.ok(toolMessages.length >= 2);
  assert.ok(
    toolMessages.every((message) =>
      /denied|not found|not available|unknown/i.test(
        JSON.stringify(message.content),
      ),
    ),
  );
});

test("wildcard coding still cannot invoke its blacklisted proposal tool", async (t) => {
  const f = await fixture(t);
  f.replies.push(
    {
      tool: "propose_profile",
      args: {
        id: "must-not-exist",
        instructions: "Synthetic",
        whitelist: ["*"],
        blacklist: [],
      },
    },
    { text: "denied" },
  );
  await f.run("coding");
  assert.deepEqual(await readdir(f.proposalsRoot), []);
  assert.equal(
    (await readdir(f.profilesRoot)).includes("must-not-exist"),
    false,
  );
});

test("coding can actually write and research can actually read local documents", async (t) => {
  const f = await fixture(t);
  f.replies.push(
    {
      tool: "write",
      args: { path: "synthetic.txt", content: "synthetic evidence" },
    },
    { text: "written" },
  );
  await f.run("coding");
  assert.equal(
    await readFile(join(f.cwd, "synthetic.txt"), "utf8"),
    "synthetic evidence",
  );
  f.replies.push(
    { tool: "read", args: { path: "synthetic.txt" } },
    { text: "read" },
  );
  await f.run("research");
  assert.ok(
    JSON.stringify(f.received.at(-1)?.messages).includes("synthetic evidence"),
  );
});

test("profile histories resume independently and new-session does not delete history", async (t) => {
  const f = await fixture(t);
  const coding = await f.run("coding", "synthetic-coding-only-marker");
  const research = await f.run("research", "synthetic-research-only-marker");
  assert.ok(
    !JSON.stringify(f.received.at(-1)?.messages).includes(
      "synthetic-coding-only-marker",
    ),
  );
  const resumed = await f.run("coding", "Resume coding");
  const messages = JSON.stringify(f.received.at(-1)?.messages);
  assert.ok(messages.includes("synthetic-coding-only-marker"));
  assert.ok(!messages.includes("synthetic-research-only-marker"));
  assert.equal(resumed.sessionFile, coding.sessionFile);
  assert.notEqual(research.sessionFile, coding.sessionFile);
  const fresh = await f.run("coding", "Start fresh", true);
  assert.notEqual(fresh.sessionFile, coding.sessionFile);
  assert.ok(
    !JSON.stringify(f.received.at(-1)?.messages).includes(
      "synthetic-coding-only-marker",
    ),
  );
  assert.equal(
    (await readdir(join(f.stateRoot, "coding", "sessions"))).length,
    2,
  );
});

test("model errors do not leak provider bodies and release the profile lock", async (t) => {
  const f = await fixture(t);
  f.replies.push({ status: 503 });
  await assert.rejects(f.run("coding"), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("synthetic-private-provider-error"));
    return true;
  });
  assert.equal(f.received.length, 1);
  assert.ok(
    !(await readdir(join(f.stateRoot, "coding"))).includes("turn.lock"),
  );
  assert.equal((await f.run("coding")).output, "synthetic done");
});

test("token-limited responses reject without exposing partial output and release the lock", async (t) => {
  const f = await fixture(t);
  let requests = 0;
  for (const id of ["coding", "research", "profile-builder"]) {
    for (const text of ["synthetic-private-partial-answer", ""]) {
      f.replies.push({ text, finish: "length" });
      await assert.rejects(f.run(id), (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "IncompleteProfileResponseError");
        assert.match(error.message, /truncated.*output limit/i);
        assert.ok(!error.message.includes("synthetic-private-partial-answer"));
        return true;
      });
      assert.equal(f.received.length, ++requests);
      assert.ok(!(await readdir(join(f.stateRoot, id))).includes("turn.lock"));
      assert.equal(
        (await f.run(id, "Resume after incomplete response")).output,
        "synthetic done",
      );
      assert.equal(f.received.length, ++requests);
    }
  }
});

test("truncated tool calls are not executed or automatically reissued", async (t) => {
  const f = await fixture(t);
  f.replies.push({
    tool: "write",
    args: {
      path: "must-not-exist.txt",
      content: "synthetic partial arguments",
    },
    finish: "length",
  });
  await assert.rejects(f.run("coding"), {
    name: "IncompleteProfileResponseError",
  });
  assert.equal(f.received.length, 1);
  assert.deepEqual(await readdir(f.cwd), []);
});

test("a truncated final answer rejects without repeating earlier completed tool actions", async (t) => {
  const f = await fixture(t);
  f.replies.push(
    {
      tool: "write",
      args: { path: "completed.txt", content: "synthetic completed action" },
    },
    { text: "synthetic-private-partial-summary", finish: "length" },
  );
  await assert.rejects(f.run("coding"), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "IncompleteProfileResponseError");
    assert.match(
      error.message,
      /Earlier tool actions may already have completed/,
    );
    assert.ok(!error.message.includes("synthetic-private-partial-summary"));
    return true;
  });
  assert.equal(f.received.length, 2);
  assert.equal(
    await readFile(join(f.cwd, "completed.txt"), "utf8"),
    "synthetic completed action",
  );
});

test("busy profiles fail closed without making a model call", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.stateRoot, "coding"));
  await writeFile(
    join(f.stateRoot, "coding", "turn.lock"),
    "synthetic active turn",
  );
  await assert.rejects(f.run("coding"), /busy/);
  assert.equal(f.received.length, 0);
});

test("profile-builder creates only a draft through the actual Pi tool loop", async (t) => {
  const f = await fixture(t);
  f.replies.push(
    {
      tool: "propose_profile",
      args: {
        id: "synthetic-helper",
        instructions: "A synthetic helper.",
        whitelist: ["read"],
        blacklist: ["bash"],
      },
    },
    { text: "drafted" },
  );
  await f.run("profile-builder");
  const reviewed = await reviewProposal(f.proposalsRoot, "synthetic-helper");
  assert.equal(
    reviewed.definition.configuration?.model.id,
    "glm-5.3-flash-cloud",
  );
  await assert.rejects(lookupProfile(f.profilesRoot, "synthetic-helper"));
});

test("approval is digest-bound, validated, non-overwriting and separate from drafts", async (t) => {
  const f = await fixture(t);
  const proposal = await createProposal(
    f.profilesRoot,
    f.proposalsRoot,
    draft(),
    { operation: "create", origin: "profile-builder" },
  );
  await assert.rejects(
    approveProposal(
      f.profilesRoot,
      f.proposalsRoot,
      proposal.id,
      "0".repeat(64),
    ),
    /digest/,
  );
  const reviewed = await reviewProposal(f.proposalsRoot, proposal.id);
  assert.equal(proposal.digest, reviewed.digest);
  await approveProposal(
    f.profilesRoot,
    f.proposalsRoot,
    proposal.id,
    proposal.digest,
  );
  assert.equal(
    (await lookupProfile(f.profilesRoot, proposal.id)).configuration
      ?.instructions,
    "A synthetic helper.",
  );
  await assert.rejects(
    approveProposal(
      f.profilesRoot,
      f.proposalsRoot,
      proposal.id,
      proposal.digest,
    ),
    (error) => error instanceof Error,
  );
  await assert.rejects(
    createProposal(f.profilesRoot, f.proposalsRoot, draft("coding"), {
      operation: "create",
      origin: "profile-builder",
    }),
    /overwritten/,
  );
  await assert.rejects(
    createProposal(f.profilesRoot, f.proposalsRoot, draft("../bad"), {
      operation: "create",
      origin: "profile-builder",
    }),
  );
  const storedDefinition = JSON.parse(
    await readFile(join(f.profilesRoot, proposal.id, "profile.json"), "utf8"),
  );
  const { home: _home, ...expected } = reviewed.definition;
  void _home;
  assert.deepEqual(storedDefinition, expected);
});

test("a minimal SOUL-only profile runs with shared defaults", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "shared"));
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      model: { provider: "cli-proxy", id: "glm-5.3-flash-cloud" },
      tools: { whitelist: ["read", "ls"], blacklist: ["bash"] },
      mandatory: { tools: { blacklist: ["propose_profile"] } },
    }),
  );
  await writeFile(
    join(f.profilesRoot, "shared", "REX_SOUL.md"),
    "Shared synthetic persona.",
  );
  await mkdir(join(f.profilesRoot, "minimal"));
  await writeFile(
    join(f.profilesRoot, "minimal", "SOUL.md"),
    "Minimal persona.",
  );

  f.replies.push({ tool: "bash", args: { command: "echo ignored" } });
  const result = await f.run("minimal");
  assert.equal(result.profileId, "minimal");
  assert.equal(result.model, "glm-5.3-flash-cloud");
  assert.equal(result.output, "synthetic done");
  const request = f.received.at(-1)!;
  assert.equal(request.model, "glm-5.3-flash-cloud");
  assert.ok(
    JSON.stringify(request.messages).includes("Shared synthetic persona."),
  );
  assert.ok(JSON.stringify(request.messages).includes("Minimal persona."));
  const tools = request.tools?.map((tool) => tool.function.name) ?? [];
  assert.deepEqual([...tools].sort(), ["ls", "read"]);
  const toolMessages = f.received.flatMap((req) =>
    req.messages.filter((message) => message.role === "tool"),
  );
  assert.ok(
    toolMessages.some((message) =>
      /denied|not found|not available|unknown/i.test(
        JSON.stringify(message.content),
      ),
    ),
  );
  assert.deepEqual(await readdir(f.cwd), []);
});

test("SOUL-only profiles fail closed without shared configuration", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "minimal"));
  await writeFile(
    join(f.profilesRoot, "minimal", "SOUL.md"),
    "Minimal persona.",
  );
  await assert.rejects(
    f.run("minimal"),
    (error) => error instanceof ProfileError,
  );
  assert.equal(f.received.length, 0);
});
