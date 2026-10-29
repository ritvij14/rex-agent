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
import { dirname, join } from "node:path";
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
  | { status: number }
  | { hold: true };
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
  for (const id of ["coding", "research", "qa", "profile-builder"]) {
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
    if ("hold" in reply) return;
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
    run: (
      id: string,
      prompt = "Synthetic task",
      newSession = false,
      maintain = false,
    ) =>
      runProfileRequest({
        ...options,
        input: `profile: ${id}\n${prompt}`,
        newSession,
        maintain,
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

test("shipped profiles load their role, fixed GLM model and permitted tools", async (t) => {
  const f = await fixture(t);
  for (const id of ["coding", "research", "qa", "profile-builder"]) {
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
    assert.equal(tools.includes("bash"), id === "coding" || id === "qa");
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

test("self-update is absent unless the operator requested maintenance", async (t) => {
  const f = await fixture(t);
  const shared = join(f.profilesRoot, "shared");
  await mkdir(shared);
  await writeFile(join(shared, "configuration.json"), '{"version":2}\n');
  f.replies.push(
    {
      tool: "revise_profile",
      args: {
        id: "coding",
        instructions: "Synthetic revised instruction.",
      },
    },
    { text: "denied" },
  );
  const result = await f.run("coding");
  assert.equal(result.toolNames.includes("revise_profile"), false);
  assert.equal(result.output, "denied");
  assert.deepEqual(await readdir(f.proposalsRoot), []);
  assert.equal(
    await readFile(join(shared, "configuration.json"), "utf8"),
    '{"version":2}\n',
  );
});

test("maintenance drafts a narrower change only for the running profile", async (t) => {
  const f = await fixture(t);
  const shared = join(f.profilesRoot, "shared");
  await mkdir(shared);
  const sharedText = '{"version":2}\n';
  await writeFile(join(shared, "configuration.json"), sharedText);
  const active = await readFile(
    join(f.profilesRoot, "coding", "profile.json"),
    "utf8",
  );
  f.replies.push(
    {
      tool: "revise_profile",
      args: {
        id: "research",
        instructions: "Must not revise research.",
      },
    },
    { text: "rejected" },
  );
  await f.run("coding", "Revise another profile", false, true);
  assert.deepEqual(await readdir(f.proposalsRoot), []);

  f.replies.push(
    {
      tool: "revise_profile",
      args: {
        id: "coding",
        instructions: "Synthetic revised instruction.",
        whitelist: ["*"],
        blacklist: [],
      },
    },
    { text: "rejected" },
  );
  await f.run("coding", "Add a tool", false, true);
  assert.deepEqual(await readdir(f.proposalsRoot), []);

  f.replies.push(
    {
      tool: "revise_profile",
      args: {
        id: "coding",
        instructions: "Synthetic revised instruction.",
        whitelist: ["read", "ls"],
        blacklist: ["bash", "edit", "write", "propose_profile"],
      },
    },
    { text: "drafted" },
  );
  const result = await f.run("coding", "Revise coding", false, true);
  assert.equal(result.toolNames.includes("revise_profile"), true);
  assert.equal(result.output, "drafted");
  const reviewed = await reviewProposal(f.proposalsRoot, "coding");
  assert.equal(reviewed.provenance.operation, "update");
  assert.equal(reviewed.provenance.origin, "coding");
  assert.equal(reviewed.provenance.baseDigest?.length, 64);
  assert.equal(
    reviewed.definition.configuration?.instructions,
    "Synthetic revised instruction.",
  );
  assert.equal(
    reviewed.definition.configuration?.tools.whitelist.includes("bash"),
    false,
  );
  assert.equal(
    await readFile(join(f.profilesRoot, "coding", "profile.json"), "utf8"),
    active,
  );
  assert.equal(
    await readFile(join(shared, "configuration.json"), "utf8"),
    sharedText,
  );
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

test("maintenance preserves a SOUL-only profile and shared inheritance", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "shared"));
  const shared = JSON.stringify({
    version: 2,
    model: { provider: "cli-proxy", id: "glm-5.3-flash-cloud" },
    tools: { whitelist: ["read", "ls"], blacklist: ["bash"] },
  });
  await writeFile(join(f.profilesRoot, "shared", "configuration.json"), shared);
  await mkdir(join(f.profilesRoot, "minimal"));
  await writeFile(join(f.profilesRoot, "minimal", "SOUL.md"), "Original soul.");
  f.replies.push(
    {
      tool: "revise_profile",
      args: { id: "minimal", instructions: "Revised soul." },
    },
    { text: "drafted" },
  );
  await f.run("minimal", "Revise yourself", false, true);
  const draft = await reviewProposal(f.proposalsRoot, "minimal");
  assert.equal(draft.definition.soul, "Revised soul.");
  assert.equal(draft.definition.model, undefined);
  assert.equal(draft.definition.tools, undefined);
  assert.equal(
    (await lookupProfile(f.profilesRoot, "minimal")).soul,
    "Original soul.",
  );
  await approveProposal(
    f.profilesRoot,
    f.proposalsRoot,
    "minimal",
    draft.digest,
  );
  assert.equal(
    (await lookupProfile(f.profilesRoot, "minimal")).soul,
    "Revised soul.",
  );
  await f.run("minimal", "Fresh turn", true);
  const messages = f.received.at(-1)!.messages;
  assert.ok(JSON.stringify(messages).includes("Revised soul."));
  assert.ok(!JSON.stringify(messages).includes("Original soul."));
  assert.equal(
    await readFile(
      join(f.profilesRoot, "shared", "configuration.json"),
      "utf8",
    ),
    shared,
  );
});

test("SOUL maintenance rejects invalid text and tool expansion without a draft", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "shared"));
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      model: { provider: "cli-proxy", id: "glm-5.3-flash-cloud" },
      tools: { whitelist: ["read"], blacklist: [] },
    }),
  );
  await mkdir(join(f.profilesRoot, "minimal"));
  await writeFile(join(f.profilesRoot, "minimal", "SOUL.md"), "Original soul.");
  for (const change of [
    { instructions: " " },
    { instructions: "é".repeat(8193) },
    { whitelist: ["read", "write"] },
    { model: "" },
    { id: "coding", instructions: "Other profile." },
  ]) {
    f.replies.push(
      { tool: "revise_profile", args: { id: "minimal", ...change } },
      { text: "rejected" },
    );
    await f.run("minimal", "Invalid revision", true, true);
    assert.deepEqual(await readdir(f.proposalsRoot), []);
    assert.equal(
      (await lookupProfile(f.profilesRoot, "minimal")).soul,
      "Original soul.",
    );
  }
});

test("operator catalog controls output metadata and denies an unlisted model", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "shared"));
  const path = join(f.profilesRoot, "shared", "configuration.json");
  const entry = {
    id: "glm-5.3-flash-cloud",
    api: "openai-completions",
    contextWindow: 65536,
    maxOutputTokens: 128,
    reasoning: false,
  };
  await writeFile(path, JSON.stringify({ version: 2, models: [entry] }));
  await f.run("coding");
  const request = f.received.at(-1)!;
  assert.equal(request.max_tokens ?? request.max_completion_tokens, 128);
  const before = f.received.length;
  await writeFile(
    path,
    JSON.stringify({ version: 2, models: [{ ...entry, id: "another-model" }] }),
  );
  await assert.rejects(f.run("coding"), /catalog/);
  assert.equal(f.received.length, before);
});

test("catalog API selects Anthropic messages instead of chat completions", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "shared"));
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      models: [
        {
          id: "glm-5.3-flash-cloud",
          api: "anthropic-messages",
          contextWindow: 65536,
          maxOutputTokens: 128,
          reasoning: false,
        },
      ],
    }),
  );
  let observedPath = "";
  let observedLimit = 0;
  const server = createServer(async (req, res) => {
    observedPath = req.url ?? "";
    let body = "";
    for await (const chunk of req) body += chunk;
    observedLimit = JSON.parse(body).max_tokens;
    res.setHeader("content-type", "text/event-stream");
    const events = [
      {
        type: "message_start",
        message: {
          id: "synthetic",
          type: "message",
          role: "assistant",
          model: "glm-5.3-flash-cloud",
          content: [],
          usage: { input_tokens: 1, output_tokens: 0 },
          stop_reason: null,
          stop_sequence: null,
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "catalog answer" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 2 },
      },
      { type: "message_stop" },
    ];
    for (const event of events)
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const result = await runProfileRequest({
    ...f,
    input: "profile: coding\nCheck catalog API",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });
  assert.equal(result.output, "catalog answer");
  assert.equal(observedPath, "/v1/messages?beta=true");
  assert.equal(observedLimit, 128);
});

test("a request override is authorized, sent on the wire, and never changes the default", async (t) => {
  const f = await fixture(t);
  const path = join(f.profilesRoot, "coding", "profile.json");
  const definition = JSON.parse(await readFile(path, "utf8"));
  definition.configuration.model.overrides = ["alternate-model"];
  const text = JSON.stringify(definition);
  await writeFile(path, text);
  await mkdir(join(f.profilesRoot, "shared"));
  const catalog = [
    "glm-5.3-flash-cloud",
    "alternate-model",
    "another-model",
  ].map((id) => ({
    id,
    api: "openai-completions",
    contextWindow: 32768,
    maxOutputTokens: 0,
    reasoning: false,
  }));
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({ version: 2, models: catalog }),
  );
  const options = {
    ...f,
    input: "profile: coding\nTemporary model selection",
    modelOverride: "alternate-model",
  };
  const selected = await runProfileRequest(options);
  assert.equal(selected.model, "alternate-model");
  assert.equal(f.received.at(-1)!.model, "alternate-model");
  assert.equal(await readFile(path, "utf8"), text);
  const before = f.received.length;
  await assert.rejects(
    runProfileRequest({ ...options, modelOverride: "another-model" }),
    /not allowed/,
  );
  assert.equal(f.received.length, before);
  assert.equal((await f.run("coding")).model, "glm-5.3-flash-cloud");
  assert.equal(f.received.at(-1)!.model, "glm-5.3-flash-cloud");
});

async function fallbackFixture(t: TestContext) {
  const f = await fixture(t);
  const path = join(f.profilesRoot, "coding", "profile.json");
  const definition = JSON.parse(await readFile(path, "utf8"));
  definition.configuration.model.fallbacks = ["alternate-model"];
  definition.configuration.model.overrides = ["alternate-model"];
  await writeFile(path, JSON.stringify(definition));
  await mkdir(join(f.profilesRoot, "shared"));
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      models: ["glm-5.3-flash-cloud", "alternate-model"].map((id) => ({
        id,
        api: "openai-completions",
        contextWindow: 32768,
        maxOutputTokens: 0,
        reasoning: false,
      })),
    }),
  );
  return f;
}

test("fallback selects the next catalog model only for a pre-response temporary failure", async (t) => {
  const f = await fallbackFixture(t);
  f.replies.push({ status: 503 }, { text: "fallback answer" });
  const result = await f.run("coding", "Unique fallback task");
  assert.equal(result.model, "alternate-model");
  assert.deepEqual(result.attempts, ["glm-5.3-flash-cloud", "alternate-model"]);
  assert.equal(result.output, "fallback answer");
  assert.deepEqual(
    f.received.map((r) => r.model),
    ["glm-5.3-flash-cloud", "alternate-model"],
  );
  assert.equal(
    f.received[1]!.messages.filter((m) => m.role === "user").length,
    1,
  );
  assert.ok(
    !JSON.stringify(f.received[1]!.messages).includes(
      "synthetic-private-provider-error",
    ),
  );
  await f.run("coding", "Resume after fallback");
  assert.equal(f.received.at(-1)!.model, "glm-5.3-flash-cloud");
  f.replies.push(
    { tool: "write", args: { path: "once.txt", content: "completed" } },
    { status: 503 },
  );
  const before = f.received.length;
  await assert.rejects(f.run("coding", "Write once"));
  assert.equal(f.received.length, before + 2);
  assert.equal(await readFile(join(f.cwd, "once.txt"), "utf8"), "completed");
  f.replies.push({ status: 503 });
  const beforeOverride = f.received.length;
  await assert.rejects(
    runProfileRequest({
      ...f,
      input: "profile: coding\nUse override only",
      modelOverride: "alternate-model",
    }),
  );
  assert.equal(f.received.length, beforeOverride + 1);
});

test("fallback is bounded and refuses auth errors or truncated output", async (t) => {
  const f = await fallbackFixture(t);
  for (const status of [400, 401, 403, 404]) {
    const before = f.received.length;
    f.replies.push({ status });
    await assert.rejects(f.run("coding", "No retry", true));
    assert.equal(f.received.length, before + 1);
  }
  let before = f.received.length;
  f.replies.push({ status: 503 }, { status: 503 });
  await assert.rejects(f.run("coding", "Exhaust fallbacks", true));
  assert.equal(f.received.length, before + 2);
  before = f.received.length;
  f.replies.push({ text: "Incomplete answer", finish: "length" });
  await assert.rejects(f.run("coding", "Truncated", true), /truncated/);
  assert.equal(f.received.length, before + 1);
  before = f.received.length;
  f.replies.push({ status: 429 }, { text: "rate limit fallback" });
  assert.equal(
    (await f.run("coding", "Rate limited", true)).output,
    "rate limit fallback",
  );
  assert.equal(f.received.length, before + 2);
});

test("configured thinking reaches the wire and unsupported capability fails before inference", async (t) => {
  const f = await fallbackFixture(t);
  const path = join(f.profilesRoot, "coding", "profile.json");
  const definition = JSON.parse(await readFile(path, "utf8"));
  definition.configuration.model.thinking = "low";
  await writeFile(path, JSON.stringify(definition));
  const sharedPath = join(f.profilesRoot, "shared", "configuration.json");
  const shared = JSON.parse(await readFile(sharedPath, "utf8"));
  for (const model of shared.models) model.reasoning = true;
  await writeFile(sharedPath, JSON.stringify(shared));
  f.replies.push({ status: 503 }, { text: "reasoned" });
  const result = await f.run("coding");
  assert.equal(result.model, "alternate-model");
  for (const req of f.received)
    assert.equal(
      (req as unknown as { reasoning_effort: string }).reasoning_effort,
      "low",
    );
  const before = f.received.length;
  shared.models[1].reasoning = false;
  await writeFile(sharedPath, JSON.stringify(shared));
  await assert.rejects(f.run("coding"), /reasoning/);
  assert.equal(f.received.length, before);
});

test("configured limits bound a tool loop, history, and a stalled provider", async (t) => {
  const f = await fixture(t);
  const path = join(f.profilesRoot, "coding", "profile.json");
  const definition = JSON.parse(await readFile(path, "utf8"));
  definition.configuration.limits = {
    maxRequests: 1,
    deadlineMs: 1000,
    maxHistoryBytes: 1024,
  };
  await writeFile(path, JSON.stringify(definition));
  f.replies.push({
    tool: "write",
    args: { path: "bounded.txt", content: "once" },
  });
  await assert.rejects(
    f.run("coding", "Bound this loop", true),
    /request limit/,
  );
  assert.equal(f.received.length, 1);
  assert.equal(await readFile(join(f.cwd, "bounded.txt"), "utf8"), "once");
  assert.ok(
    !(await readdir(join(f.stateRoot, "coding"))).includes("turn.lock"),
  );
  await f.run("coding", "x".repeat(5000), true);
  const before = f.received.length;
  await assert.rejects(f.run("coding", "Resume history"), /history limit/);
  assert.equal(f.received.length, before);
  f.replies.push({ hold: true });
  await assert.rejects(f.run("coding", "Stalled request", true), /deadline/);
  assert.ok(
    !(await readdir(join(f.stateRoot, "coding"))).includes("turn.lock"),
  );
  assert.equal(
    (await f.run("coding", "Recovered", true)).output,
    "synthetic done",
  );
});

test("explicit shared and own instruction files reach inference and survive maintenance", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "shared", "resources"), { recursive: true });
  await writeFile(
    join(f.profilesRoot, "shared", "resources", "common.md"),
    "Required common instruction.",
  );
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      model: { provider: "cli-proxy", id: "glm-5.3-flash-cloud" },
      tools: { whitelist: ["read"], blacklist: [] },
      resources: { instructions: ["resources/common.md"] },
    }),
  );
  await mkdir(join(f.profilesRoot, "minimal", "resources"), {
    recursive: true,
  });
  await writeFile(
    join(f.profilesRoot, "minimal", "SOUL.md"),
    "Minimal persona.",
  );
  await writeFile(
    join(f.profilesRoot, "minimal", "profile.json"),
    JSON.stringify({
      version: 2,
      id: "minimal",
      resources: { instructions: ["resources/own.md"] },
    }),
  );
  await writeFile(
    join(f.profilesRoot, "minimal", "resources", "own.md"),
    "Own explicit instruction.",
  );
  await writeFile(
    join(f.profilesRoot, "minimal", "resources", "ignored.md"),
    "Must not be discovered.",
  );
  await f.run("minimal");
  const messages = JSON.stringify(f.received.at(-1)!.messages);
  assert.ok(messages.includes("Required common instruction."));
  assert.ok(messages.includes("Own explicit instruction."));
  assert.ok(!messages.includes("Must not be discovered."));
  f.replies.push(
    {
      tool: "revise_profile",
      args: { id: "minimal", instructions: "Revised persona." },
    },
    { text: "drafted" },
  );
  await f.run("minimal", "Revise yourself", false, true);
  const reviewed = await reviewProposal(f.proposalsRoot, "minimal");
  assert.deepEqual(reviewed.definition.resources, {
    instructions: ["resources/own.md"],
  });
  await writeFile(
    join(f.proposalsRoot, "minimal", "resources", "own.md"),
    "Changed after review.",
  );
  await assert.rejects(
    approveProposal(
      f.profilesRoot,
      f.proposalsRoot,
      "minimal",
      reviewed.digest,
    ),
    /digest/,
  );
  const changed = await reviewProposal(f.proposalsRoot, "minimal");
  await approveProposal(
    f.profilesRoot,
    f.proposalsRoot,
    "minimal",
    changed.digest,
  );
  assert.equal(
    await readFile(
      join(f.profilesRoot, "minimal", "resources", "own.md"),
      "utf8",
    ),
    "Changed after review.",
  );
  await f.run("minimal", "Fresh instructions", true);
  const next = JSON.stringify(f.received.at(-1)!.messages);
  assert.ok(next.includes("Required common instruction."));
  assert.ok(next.includes("Changed after review."));
});

test("only selected skills are advertised lazily and selected templates expand", async (t) => {
  const f = await fixture(t);
  const home = join(f.profilesRoot, "research");
  await mkdir(join(home, "resources", "skills", "review"), { recursive: true });
  await mkdir(join(home, "resources", "prompts"), { recursive: true });
  const skillPath = join(home, "resources", "skills", "review", "SKILL.md");
  const supportPath = join(home, "resources", "skills", "review", "support.md");
  await writeFile(supportPath, "SUPPORT_BODY_ONLY_AFTER_READ");
  await writeFile(
    skillPath,
    "---\nname: review\ndescription: Review synthetic evidence when asked.\n---\nSKILL_BODY_ONLY_AFTER_READ\n",
  );
  await writeFile(
    join(home, "resources", "prompts", "review.md"),
    "---\ndescription: Synthetic review template\n---\nReview selected evidence for $1.",
  );
  await mkdir(join(home, "resources", "skills", "stray"));
  await writeFile(
    join(home, "resources", "skills", "stray", "SKILL.md"),
    "---\nname: stray\ndescription: STRAY_SKILL_MUST_NOT_LOAD\n---\nStray body.",
  );
  const path = join(home, "profile.json");
  const definition = JSON.parse(await readFile(path, "utf8"));
  definition.configuration.resources = {
    skills: ["resources/skills/review/SKILL.md"],
    prompts: ["resources/prompts/review.md"],
    references: ["resources/skills/review/support.md"],
  };
  await writeFile(path, JSON.stringify(definition));
  await f.run("research", "Advertise capabilities", true);
  const first = JSON.stringify(f.received.at(-1)!.messages);
  assert.ok(first.includes("Review synthetic evidence when asked."));
  assert.ok(!first.includes("SKILL_BODY_ONLY_AFTER_READ"));
  assert.ok(!first.includes("SUPPORT_BODY_ONLY_AFTER_READ"));
  assert.ok(!first.includes("STRAY_SKILL_MUST_NOT_LOAD"));
  f.replies.push(
    { tool: "read", args: { path: skillPath } },
    { text: "read skill" },
  );
  await f.run("research", "Use the selected skill", true);
  assert.ok(
    JSON.stringify(f.received.at(-1)!.messages).includes(
      "SKILL_BODY_ONLY_AFTER_READ",
    ),
  );
  f.replies.push(
    { tool: "read", args: { path: supportPath } },
    { text: "read support" },
  );
  await f.run("research", "Read selected support", true);
  assert.ok(
    JSON.stringify(f.received.at(-1)!.messages).includes(
      "SUPPORT_BODY_ONLY_AFTER_READ",
    ),
  );
  await f.run("research", "/review correctness", true);
  assert.ok(
    JSON.stringify(f.received.at(-1)!.messages).includes(
      "Review selected evidence for correctness.",
    ),
  );
  f.replies.push(
    {
      tool: "write",
      args: { path: "forbidden.txt", content: "must not exist" },
    },
    { text: "denied" },
  );
  await f.run("research", "/skill:review Try to write a file", true);
  assert.deepEqual(await readdir(f.cwd), []);
});

test("malformed or colliding skill metadata stops before inference", async (t) => {
  const f = await fixture(t);
  const home = join(f.profilesRoot, "research");
  await mkdir(join(home, "resources", "skills", "one"), { recursive: true });
  await mkdir(join(home, "resources", "skills", "two"), { recursive: true });
  const one = join(home, "resources", "skills", "one", "SKILL.md");
  const two = join(home, "resources", "skills", "two", "SKILL.md");
  const path = join(home, "profile.json");
  const definition = JSON.parse(await readFile(path, "utf8"));
  definition.configuration.resources = {
    skills: ["resources/skills/one/SKILL.md"],
  };
  await writeFile(path, JSON.stringify(definition));
  await writeFile(one, "---\nname: one\n---\nMissing description.");
  await assert.rejects(f.run("research"), /skills/);
  assert.equal(f.received.length, 0);
  await writeFile(
    one,
    "---\nname: collision\ndescription: First selected skill.\n---\nFirst body.",
  );
  await writeFile(
    two,
    "---\nname: collision\ndescription: Second selected skill.\n---\nSecond body.",
  );
  definition.configuration.resources.skills.push(
    "resources/skills/two/SKILL.md",
  );
  await writeFile(path, JSON.stringify(definition));
  await assert.rejects(f.run("research"), /skills/);
  assert.equal(f.received.length, 0);
});

test("colliding selected prompt names fail before inference", async (t) => {
  const f = await fixture(t);
  const home = join(f.profilesRoot, "research");
  const paths = ["resources/first/review.md", "resources/second/review.md"];
  for (const path of paths) {
    await mkdir(dirname(join(home, path)), { recursive: true });
    await writeFile(join(home, path), "Review selected evidence.");
  }
  const manifest = join(home, "profile.json");
  const definition = JSON.parse(await readFile(manifest, "utf8"));
  definition.configuration.resources = { prompts: paths };
  await writeFile(manifest, JSON.stringify(definition));
  await assert.rejects(f.run("research"), /prompt/);
  assert.equal(f.received.length, 0);
});

test("workspace instructions load only after explicit opt-in and stay fixed during a turn", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.cwd, "AGENTS.md"),
    "Original selected workspace instruction.",
  );
  await f.run("coding", "Before opt-in", true);
  assert.ok(
    !JSON.stringify(f.received.at(-1)!.messages).includes(
      "Original selected workspace instruction.",
    ),
  );
  const path = join(f.profilesRoot, "coding", "profile.json");
  const definition = JSON.parse(await readFile(path, "utf8"));
  definition.configuration.resources = { workspaceInstructions: ["AGENTS.md"] };
  await writeFile(path, JSON.stringify(definition));
  f.replies.push(
    {
      tool: "write",
      args: { path: "AGENTS.md", content: "Changed workspace instruction." },
    },
    { text: "changed" },
  );
  await f.run("coding", "Change the selected workspace file", true);
  const system = JSON.stringify(
    f.received.at(-1)!.messages.filter((m) => m.role === "system"),
  );
  assert.ok(system.includes("Original selected workspace instruction."));
  assert.ok(!system.includes("Changed workspace instruction."));
  await f.run("coding", "New turn", true);
  assert.ok(
    JSON.stringify(
      f.received.at(-1)!.messages.filter((m) => m.role === "system"),
    ).includes("Changed workspace instruction."),
  );
});

test("selected installed extension requires matching integrity and tool permission", async (t) => {
  const { createHash } = await import("node:crypto");
  const f = await fixture(t);
  const installed = join(f.cwd, "operator-installed");
  await mkdir(installed);
  const code = `import {writeFile} from 'node:fs/promises'; export default pi => {pi.registerTool({name:'extension_probe',label:'Probe',description:'Synthetic installed probe.',parameters:{type:'object',properties:{},additionalProperties:false},async execute(_id,_params,_signal,_update,ctx){await writeFile(ctx.cwd+'/extension-marker.txt','executed');return {content:[{type:'text',text:'extension probe success'}],details:{}}}})};`;
  await writeFile(join(installed, "probe.mjs"), code);
  const digest = createHash("sha256").update(code).digest("hex");
  await mkdir(join(f.profilesRoot, "shared"));
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      extensionCatalog: [
        { id: "probe", sha256: digest, tools: ["extension_probe"] },
      ],
    }),
  );
  const manifest = join(f.profilesRoot, "research", "profile.json");
  const definition = JSON.parse(await readFile(manifest, "utf8"));
  definition.configuration.resources = { extensions: ["probe"] };
  await writeFile(manifest, JSON.stringify(definition));
  const options = {
    ...f,
    installedExtensionsRoot: installed,
    input: "profile: research\nUse selected extension",
    newSession: true,
  };
  f.replies.push({ tool: "extension_probe", args: {} }, { text: "denied" });
  await runProfileRequest(options);
  await assert.rejects(readFile(join(f.cwd, "extension-marker.txt")));
  definition.configuration.tools.whitelist.push("extension_probe");
  await writeFile(manifest, JSON.stringify(definition));
  f.replies.push({ tool: "extension_probe", args: {} }, { text: "executed" });
  const allowed = await runProfileRequest(options);
  assert.ok(allowed.toolNames.includes("extension_probe"));
  assert.equal(
    await readFile(join(f.cwd, "extension-marker.txt"), "utf8"),
    "executed",
  );
  await writeFile(join(installed, "probe.mjs"), code + "\n");
  const before = f.received.length;
  await assert.rejects(runProfileRequest(options), /extension/);
  assert.equal(f.received.length, before);
  await writeFile(join(installed, "probe.mjs"), code);
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify({
      version: 2,
      extensionCatalog: [
        { id: "probe", sha256: digest, tools: ["different_probe"] },
      ],
    }),
  );
  definition.configuration.tools.whitelist = ["read", "ls"];
  await writeFile(manifest, JSON.stringify(definition));
  await assert.rejects(runProfileRequest(options), /catalog/);
  assert.equal(f.received.length, before);
});

test("installed extension nested calls cannot bypass the tool blacklist", async (t) => {
  const { createHash } = await import("node:crypto");
  const f = await fixture(t);
  const installed = join(f.cwd, "operator-installed");
  await mkdir(installed);
  const code = await readFile(
    new URL("../../../lab/terminal/fixture-extension.mjs", import.meta.url),
    "utf8",
  );
  await writeFile(join(installed, "fixture.mjs"), code);
  await writeFile(
    join(installed, "unselected.mjs"),
    "throw new Error('unselected module executed');",
  );
  await mkdir(join(f.profilesRoot, "shared"));
  const shared = {
    version: 2,
    extensionCatalog: [
      {
        id: "fixture",
        sha256: createHash("sha256").update(code).digest("hex"),
        tools: ["fixture_probe"],
      },
    ],
  };
  await writeFile(
    join(f.profilesRoot, "shared", "configuration.json"),
    JSON.stringify(shared),
  );
  const path = join(f.profilesRoot, "research", "profile.json");
  const definition = JSON.parse(await readFile(path, "utf8"));
  definition.configuration.resources = { extensions: ["fixture"] };
  definition.configuration.tools.whitelist.push("fixture_probe");
  await writeFile(path, JSON.stringify(definition));
  const options = {
    ...f,
    installedExtensionsRoot: installed,
    input: "profile: research\nNested extension check",
  };
  f.replies.push(
    { tool: "fixture_probe", args: { nested: true } },
    { text: "denied" },
  );
  assert.equal((await runProfileRequest(options)).output, "denied");
  await assert.rejects(readFile(join(f.cwd, "extension-forbidden.txt")));
  await assert.rejects(readFile(join(f.cwd, "extension-marker.txt")));
  const before = f.received.length;
  await assert.rejects(
    runProfileRequest({ ...options, installedExtensionsRoot: undefined }),
    /extension/,
  );
  assert.equal(f.received.length, before);
});

test("all selected extension integrity is checked before importing any module", async (t) => {
  const { createHash } = await import("node:crypto");
  const { symlink } = await import("node:fs/promises");
  const f = await fixture(t);
  const installed = join(f.cwd, "operator-installed");
  await mkdir(installed);
  const marker = join(installed, "import-marker.txt");
  const code = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'imported'); export default pi => {};`;
  await writeFile(join(installed, "first.mjs"), code);
  await writeFile(join(installed, "second.mjs"), "export default pi => {};");
  await mkdir(join(f.profilesRoot, "shared"));
  const shared = {
    version: 2,
    extensionCatalog: [
      {
        id: "first",
        sha256: createHash("sha256").update(code).digest("hex"),
        tools: [] as string[],
      },
      { id: "second", sha256: "0".repeat(64), tools: [] as string[] },
    ],
  };
  const configPath = join(f.profilesRoot, "shared", "configuration.json");
  await writeFile(configPath, JSON.stringify(shared));
  const manifest = join(f.profilesRoot, "research", "profile.json");
  const definition = JSON.parse(await readFile(manifest, "utf8"));
  definition.configuration.resources = { extensions: ["first", "second"] };
  await writeFile(manifest, JSON.stringify(definition));
  const options = {
    ...f,
    installedExtensionsRoot: installed,
    input: "profile: research\nExtension preflight",
  };
  await assert.rejects(runProfileRequest(options), /extension/);
  await assert.rejects(readFile(marker));
  assert.equal(f.received.length, 0);
  definition.configuration.resources.extensions = ["first"];
  await writeFile(manifest, JSON.stringify(definition));
  await rm(join(installed, "first.mjs"));
  await symlink(join(installed, "second.mjs"), join(installed, "first.mjs"));
  await assert.rejects(runProfileRequest(options), /extension/);
  await assert.rejects(readFile(marker));
  assert.equal(f.received.length, 0);
});

test("fallback never replays lifecycle hooks from installed executable code", async (t) => {
  const { createHash } = await import("node:crypto");
  const f = await fallbackFixture(t);
  const installed = join(f.cwd, "operator-installed");
  await mkdir(installed);
  const counter = join(f.cwd, "hook-calls.txt");
  const code = `import {appendFile} from 'node:fs/promises'; export default pi => pi.on('before_provider_request',async () => {await appendFile(${JSON.stringify(counter)},'called');});`;
  await writeFile(join(installed, "hooks.mjs"), code);
  const sharedPath = join(f.profilesRoot, "shared", "configuration.json");
  const shared = JSON.parse(await readFile(sharedPath, "utf8"));
  shared.extensionCatalog = [
    {
      id: "hooks",
      sha256: createHash("sha256").update(code).digest("hex"),
      tools: [],
    },
  ];
  await writeFile(sharedPath, JSON.stringify(shared));
  const manifest = join(f.profilesRoot, "coding", "profile.json");
  const definition = JSON.parse(await readFile(manifest, "utf8"));
  definition.configuration.resources = { extensions: ["hooks"] };
  await writeFile(manifest, JSON.stringify(definition));
  f.replies.push({ status: 503 }, { text: "must not retry lifecycle code" });
  await assert.rejects(
    runProfileRequest({
      ...f,
      installedExtensionsRoot: installed,
      input: "profile: coding\nDo not replay executable hooks",
    }),
  );
  assert.equal(f.received.length, 1);
  assert.equal(await readFile(counter, "utf8"), "called");
});

test("a selected remote MCP server serves tools and resources through the connector router", async (t) => {
  const f = await remoteMcpFixture(t);
  f.replies.push(
    { tool: "mcp__remote_docs__inspect", args: {} },
    {
      tool: "read_mcp_resource",
      args: { server: "remote-docs", uri: "remote://evidence" },
    },
    { text: "finished" },
  );
  await runProfileRequest(f.options);
  const history = JSON.stringify(f.received.at(-1)!.messages);
  assert.ok(history.includes("REMOTE_MCP_EVIDENCE"));
  assert.ok(history.includes("REMOTE_RESOURCE_EVIDENCE"));
  assert.ok(!history.includes("MCP_META_MUST_STAY_PRIVATE"));
  assert.ok(!history.includes("placeholder.invalid"));
  assert.ok(
    f.requests.some(
      (r) =>
        r.path === "/remote-docs/mcp" &&
        r.headers["mcp-session-id"] === "fake-session-1",
    ),
  );
  assert.equal(f.mutations(), 0);
  assert.ok(f.sessionDeleted(), "closing the turn must DELETE the session");
});

test("remote MCP denials, failures and a missing router cannot dispatch a mutation", async (t) => {
  const f = await remoteMcpFixture(t);
  f.replies.push(
    { tool: "mcp__remote_docs__mutate", args: {} },
    { text: "denied" },
  );
  const denied = await runProfileRequest(f.options);
  const records = (await readFile(denied.sessionFile!, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    records.some(
      (entry) =>
        entry.message?.toolName === "mcp__remote_docs__mutate" &&
        entry.message.isError === true,
    ),
  );
  assert.equal(f.mutations(), 0);
  const failing = await remoteMcpFixture(t, true);
  failing.replies.push({
    tool: "mcp__remote_docs__inspect",
    args: { fail: true },
  });
  await assert.rejects(runProfileRequest(failing.options));
  assert.equal(failing.received.length, 1);
  assert.equal(failing.mutations(), 0);
  const routerless = await remoteMcpFixture(t);
  delete (routerless.options as { remoteMcpOrigin?: string }).remoteMcpOrigin;
  routerless.replies.push({ tool: "mcp__remote_docs__inspect", args: {} });
  await assert.rejects(runProfileRequest(routerless.options), /Local MCP/);
  assert.equal(routerless.received.length, 0);
  assert.equal(routerless.requests.length, 0);
});

function remoteJson(id: unknown, result: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

async function remoteMcpFixture(t: TestContext, failCalls = false) {
  const f = await fixture(t);
  await mkdir(join(f.profilesRoot, "shared"), { recursive: true });
  const sharedPath = join(f.profilesRoot, "shared", "configuration.json");
  const shared = {
    version: 2,
    remoteMcpCatalog: [
      {
        id: "remote-docs",
        url: "https://placeholder.invalid:9/mcp",
        tools: ["inspect", "mutate"],
        resources: true,
      },
    ],
  };
  await writeFile(sharedPath, JSON.stringify(shared));
  const manifest = join(f.profilesRoot, "research", "profile.json");
  const definition = JSON.parse(await readFile(manifest, "utf8"));
  definition.configuration.resources = { mcp: ["remote-docs"] };
  definition.configuration.tools.whitelist.push(
    "mcp__remote_docs__inspect",
    "mcp__remote_docs__mutate",
    "read_mcp_resource",
  );
  definition.configuration.tools.blacklist.push("mcp__remote_docs__mutate");
  await writeFile(manifest, JSON.stringify(definition));
  const requests: {
    path: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  }[] = [];
  let mutations = 0;
  let sessionDeleted = false;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (
          typeof value === "string" &&
          !["authorization", "cookie", "set-cookie"].includes(name)
        )
          headers[name] = value;
      }
      const parsed = body
        ? (JSON.parse(body) as {
            id?: unknown;
            method?: string;
            params?:
              | { name?: string; arguments?: { fail?: boolean } }
              | { uri?: string };
          })
        : {};
      requests.push({
        path: req.url ?? "",
        method: req.method ?? "",
        headers,
        body: parsed,
      });
      if (req.method === "DELETE") {
        sessionDeleted = true;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({}));
        return;
      }
      if (
        parsed.method === undefined ||
        String(parsed.method).startsWith("notifications/")
      ) {
        res.writeHead(202);
        res.end();
        return;
      }
      if (parsed.method === "initialize") {
        res.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": "fake-session-1",
        });
        res.end(
          remoteJson(parsed.id, {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: "remote-fixture", version: "0.0.0" },
          }),
        );
        return;
      }
      if (req.method === "GET") {
        res.writeHead(405);
        res.end();
        return;
      }
      if (parsed.method === "tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          remoteJson(parsed.id, {
            tools: ["inspect", "mutate"].map((name) => ({
              name,
              description: `Synthetic remote ${name}`,
              inputSchema: {
                type: "object",
                properties:
                  name === "inspect" ? { fail: { type: "boolean" } } : {},
                additionalProperties: false,
              },
            })),
          }),
        );
        return;
      }
      if (parsed.method === "tools/call") {
        const call = parsed.params as
          { name?: string; arguments?: { fail?: boolean } } | undefined;
        if (call?.name === "mutate") {
          mutations++;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            remoteJson(parsed.id, {
              content: [{ type: "text", text: "MUTATION_MUST_NOT_DISPATCH" }],
            }),
          );
          return;
        }
        if (failCalls && call?.arguments?.fail) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "synthetic remote failure" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          remoteJson(parsed.id, {
            content: [{ type: "text", text: "REMOTE_MCP_EVIDENCE" }],
          }),
        );
        return;
      }
      if (parsed.method === "resources/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          remoteJson(parsed.id, {
            resources: [
              {
                uri: "remote://evidence",
                name: "evidence",
                _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
              },
            ],
            _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
          }),
        );
        return;
      }
      if (parsed.method === "resources/read") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          remoteJson(parsed.id, {
            contents: [
              {
                uri: (parsed.params as { uri?: string } | undefined)?.uri,
                text: "REMOTE_RESOURCE_EVIDENCE",
                mimeType: "text/plain",
                _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
              },
            ],
            _meta: { private: "MCP_META_MUST_STAY_PRIVATE" },
          }),
        );
        return;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id ?? null,
          error: { code: -32601, message: "unsupported" },
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  t.after(() => server.close());
  const options = {
    ...f,
    remoteMcpOrigin: `http://127.0.0.1:${port}`,
    input: "profile: research\nUse the selected remote MCP fixture",
    newSession: true,
    signal: AbortSignal.timeout(10000),
  };
  return {
    ...f,
    sharedPath,
    shared,
    definition,
    manifest,
    requests,
    mutations: () => mutations,
    sessionDeleted: () => sessionDeleted,
    options,
  };
}

async function mcpFixture(
  t: TestContext,
  mode = "literal ${HOME}; !not-a-command",
  resources = false,
) {
  const { createHash } = await import("node:crypto");
  const f = await fixture(t);
  const installedMcpRoot = join(f.cwd, "operator-mcp");
  await mkdir(installedMcpRoot);
  const code = await readFile(
    new URL("../../../lab/terminal/fixture-mcp.mjs", import.meta.url),
  );
  await writeFile(join(installedMcpRoot, "fixture.mjs"), code);
  await writeFile(
    join(f.cwd, "mcp-workspace-proof.txt"),
    "synthetic-own-workspace",
  );
  await mkdir(join(f.profilesRoot, "shared"));
  const sharedPath = join(f.profilesRoot, "shared", "configuration.json");
  const shared = {
    version: 2,
    localMcpCatalog: [
      {
        id: "fixture",
        sha256: createHash("sha256").update(code).digest("hex"),
        tools: ["inspect", "mutate"],
        args: [mode],
        resources,
      },
    ],
  };
  await writeFile(sharedPath, JSON.stringify(shared));
  const manifest = join(f.profilesRoot, "research", "profile.json");
  const definition = JSON.parse(await readFile(manifest, "utf8"));
  definition.configuration.resources = { mcp: ["fixture"] };
  definition.configuration.tools.whitelist.push(
    "mcp__fixture__inspect",
    "mcp__fixture__mutate",
  );
  definition.configuration.tools.blacklist.push("mcp__fixture__mutate");
  if (resources)
    definition.configuration.tools.whitelist.push(
      "list_mcp_resources",
      "list_mcp_resource_templates",
      "read_mcp_resource",
    );
  await writeFile(manifest, JSON.stringify(definition));
  const options = {
    ...f,
    installedMcpRoot,
    input: "profile: research\nUse only the selected local MCP fixture",
    newSession: true,
    signal: AbortSignal.timeout(10000),
  };
  return {
    ...f,
    installedMcpRoot,
    sharedPath,
    shared,
    manifest,
    definition,
    options,
  };
}

async function assertMcpStopped(cwd: string) {
  const pid = Number(await readFile(join(cwd, "mcp-pid.txt"), "utf8"));
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  assert.throws(
    () => process.kill(pid, 0),
    (error: NodeJS.ErrnoException) => error.code === "ESRCH",
  );
}

test("deferred tool search needs its own grant but does not need Codemode", async (t) => {
  for (const grant of ["allow", "blacklist", "no-grant"]) {
    const f = await mcpFixture(t);
    await writeFile(
      f.sharedPath,
      JSON.stringify({
        ...f.shared,
        localMcpCatalog: f.shared.localMcpCatalog.map((entry) => ({
          ...entry,
          exposure: "deferred",
        })),
      }),
    );
    if (grant !== "no-grant")
      f.definition.configuration.tools.whitelist.push("tool_search");
    if (grant === "blacklist")
      f.definition.configuration.tools.blacklist.push("tool_search");
    await writeFile(f.manifest, JSON.stringify(f.definition));
    f.replies.push({ tool: "tool_search", args: { query: "inspect" } });
    if (grant === "allow")
      f.replies.push({ tool: "mcp__fixture__inspect", args: {} });
    f.replies.push({ text: "finished" });
    const result = await runProfileRequest(f.options);
    assert.ok(!result.toolNames.includes("codemode"));
    assert.equal(result.toolNames.includes("tool_search"), grant === "allow");
    if (grant === "allow")
      assert.equal(
        await readFile(join(f.cwd, "mcp-calls.txt"), "utf8"),
        "called",
      );
    else await assert.rejects(readFile(join(f.cwd, "mcp-calls.txt")));
    await assertMcpStopped(f.cwd);
  }
});

test("indirect MCP exposure hides initial declarations and discovery cannot reveal denied tools", async (t) => {
  for (const exposure of ["codemode", "deferred"]) {
    const f = await mcpFixture(t, exposure);
    await writeFile(
      f.sharedPath,
      JSON.stringify({
        ...f.shared,
        localMcpCatalog: f.shared.localMcpCatalog.map((entry) => ({
          ...entry,
          exposure,
        })),
      }),
    );
    f.definition.configuration.resources.codemode = true;
    f.definition.configuration.tools.whitelist.push("codemode", "tool_search");
    await writeFile(f.manifest, JSON.stringify(f.definition));
    f.replies.push(
      { tool: "tool_search", args: { query: "inspect", limit: 1 } },
      { tool: "mcp__fixture__inspect", args: {} },
      {
        tool: "codemode",
        args: {
          code: "const matches=await searchTools('inspect',{namespace:'fixture',limit:1});text(matches);text(await describeNamespace('fixture'));text(await tools[matches[0].name]({}));",
        },
      },
      { tool: "tool_search", args: { query: "mutate" } },
      { tool: "mcp__fixture__mutate", args: {} },
      { text: "finished" },
    );
    const result = await runProfileRequest(f.options);
    assert.ok(result.toolNames.includes("mcp__fixture__inspect"));
    assert.ok(!result.toolNames.includes("mcp__fixture__mutate"));
    const initial = f.received[0]!.tools!.map((tool) => tool.function.name);
    assert.ok(initial.includes("tool_search"));
    assert.ok(!initial.includes("mcp__fixture__inspect"));
    assert.ok(!initial.includes("mcp__fixture__mutate"));
    if (exposure === "deferred")
      assert.ok(
        !JSON.stringify(f.received[0]!.tools).includes(
          "Synthetic fixture inspect",
        ),
      );
    assert.ok(
      f.received[1]!.tools!.some(
        (tool) => tool.function.name === "mcp__fixture__inspect",
      ),
    );
    const discovery = f.received[4]!.messages.findLast(
      (message) => message.role === "tool",
    )!.content as string;
    assert.ok(discovery.includes("No matching tools found"));
    const scriptResult = f.received[3]!.messages.findLast(
      (message) => message.role === "tool",
    )!.content as string;
    assert.ok(scriptResult.includes("mcp__fixture"));
    assert.ok(!scriptResult.includes("mcp__fixture__mutate"));
    assert.equal(
      await readFile(join(f.cwd, "mcp-calls.txt"), "utf8"),
      "calledcalled",
    );
    await assert.rejects(readFile(join(f.cwd, "mcp-forbidden.txt")));
    await assertMcpStopped(f.cwd);
  }
});

test("a caught MCP protocol failure cannot permit another scripted side effect", async (t) => {
  const f = await mcpFixture(t, "reject-tool");
  f.definition.configuration.resources.codemode = true;
  f.definition.configuration.tools.whitelist.push("codemode", "write");
  f.definition.configuration.tools.blacklist =
    f.definition.configuration.tools.blacklist.filter(
      (name: string) => name !== "write",
    );
  await writeFile(f.manifest, JSON.stringify(f.definition));
  f.replies.push({
    tool: "codemode",
    args: {
      code: "await tools.write({path:'before-uncertain.txt',content:'before'});try {await tools.mcp__fixture__inspect({});} catch {} await tools.write({path:'after-uncertain.txt',content:'after'});",
    },
  });
  await assert.rejects(runProfileRequest(f.options));
  assert.equal(
    await readFile(join(f.cwd, "before-uncertain.txt"), "utf8"),
    "before",
  );
  await assert.rejects(readFile(join(f.cwd, "after-uncertain.txt")));
  assert.equal(await readFile(join(f.cwd, "mcp-calls.txt"), "utf8"), "called");
  assert.equal(f.received.length, 1);
  await assertMcpStopped(f.cwd);
});

test("built-in Codemode requires opt-in and preserves MCP permissions", async (t) => {
  const f = await mcpFixture(t, "codemode", true);
  f.definition.configuration.resources.codemode = true;
  f.definition.configuration.tools.whitelist.push("codemode");
  await writeFile(f.manifest, JSON.stringify(f.definition));
  await writeFile(join(f.cwd, "mcp-evidence.md"), "CODEMODE_RESOURCE_EVIDENCE");
  f.replies.push(
    {
      tool: "codemode",
      args: {
        code: `text('ENV_SAFE_'+typeof models+'_'+typeof process); if (ALL_TOOLS.some(t=>t.name==='mcp__fixture__mutate')) throw Error('Denied tool advertised'); text(await tools.mcp__fixture__inspect({})); text(await tools.read_mcp_resource({server:'fixture',uri:'fixture://own/evidence'})); try { await tools.mcp__fixture__mutate({}); } catch { text('MUTATION_DENIED'); } try { await tools.read_mcp_resource({server:'unselected',uri:'fixture://own/evidence'}); } catch { text('SERVER_DENIED'); }`,
      },
    },
    { text: "finished" },
  );
  const result = await runProfileRequest(f.options);
  const messages = JSON.stringify(f.received.at(-1)!.messages);
  assert.ok(messages.includes("CODEMODE_RESOURCE_EVIDENCE"));
  assert.ok(messages.includes("MUTATION_DENIED"));
  assert.ok(messages.includes("SERVER_DENIED"));
  assert.ok(!messages.includes("MCP_META_MUST_STAY_PRIVATE"));
  const observed = f.received
    .at(-1)!
    .messages.findLast((message) => message.role === "tool")!.content as string;
  assert.ok(observed.includes("ENV_SAFE_undefined_undefined"));
  assert.ok(
    (await readFile(result.sessionFile!, "utf8")).includes(
      "CODEMODE_RESOURCE_EVIDENCE",
    ),
  );
  assert.equal(await readFile(join(f.cwd, "mcp-calls.txt"), "utf8"), "called");
  assert.equal(
    await readFile(join(f.cwd, "mcp-resource-calls.txt"), "utf8"),
    "read;",
  );
  await assert.rejects(readFile(join(f.cwd, "mcp-forbidden.txt")));
  await assertMcpStopped(f.cwd);
  for (const denied of ["opt-out", "blacklist", "no-grant"]) {
    f.definition.configuration.resources.codemode = denied !== "opt-out";
    f.definition.configuration.tools.blacklist = [
      "mcp__fixture__mutate",
      ...(denied === "blacklist" ? ["codemode"] : []),
    ];
    f.definition.configuration.tools.whitelist =
      denied === "no-grant" ? ["read"] : ["codemode"];
    await writeFile(f.manifest, JSON.stringify(f.definition));
    f.replies.push(
      {
        tool: "codemode",
        args: { code: "await tools.mcp__fixture__inspect({})" },
      },
      { text: "denied" },
    );
    const result = await runProfileRequest(f.options);
    assert.ok(!result.toolNames.includes("codemode"));
    assert.equal(
      await readFile(join(f.cwd, "mcp-calls.txt"), "utf8"),
      "called",
    );
    await assertMcpStopped(f.cwd);
  }
});

test("Codemode deadline stops a busy VM and permits a fresh turn", async (t) => {
  const f = await mcpFixture(t);
  f.definition.configuration.resources.codemode = true;
  f.definition.configuration.tools.whitelist.push("codemode");
  f.definition.configuration.limits = { deadlineMs: 1000 };
  await writeFile(f.manifest, JSON.stringify(f.definition));
  f.replies.push({ tool: "codemode", args: { code: "for (;;) {}" } });
  await assert.rejects(runProfileRequest(f.options), /deadline/);
  assert.equal(f.received.length, 1);
  await assertMcpStopped(f.cwd);
  f.replies.push(
    { tool: "codemode", args: { code: "text('RECOVERED')" } },
    { text: "recovered" },
  );
  assert.equal((await runProfileRequest(f.options)).output, "recovered");
  assert.ok(
    (
      f.received
        .at(-1)!
        .messages.findLast((message) => message.role === "tool")!
        .content as string
    ).includes("RECOVERED"),
  );
  await assertMcpStopped(f.cwd);
});

test("Codemode store resumes only its own profile and commits only successful scripts", async (t) => {
  const f = await fixture(t);
  for (const id of ["coding", "research"]) {
    const path = join(f.profilesRoot, id, "profile.json");
    const definition = JSON.parse(await readFile(path, "utf8"));
    definition.configuration.resources = { codemode: true };
    definition.configuration.tools = { whitelist: ["codemode"], blacklist: [] };
    await writeFile(path, JSON.stringify(definition));
  }
  const script = async (profile: string, code: string, fresh = false) => {
    f.replies.push({ tool: "codemode", args: { code } }, { text: "finished" });
    await f.run(profile, "Run the script", fresh);
    return f.received
      .at(-1)!
      .messages.findLast((message) => message.role === "tool")!
      .content as string;
  };
  assert.ok(
    (
      await script(
        "coding",
        "store('scope','SCRIPT_STATE_ALPHA');text('stored');",
        true,
      )
    ).includes("Script completed"),
  );
  assert.ok(
    (
      await script(
        "research",
        "text(load('scope') ?? 'NO_SCRIPT_STATE');",
        true,
      )
    ).includes("NO_SCRIPT_STATE"),
  );
  assert.ok(
    !JSON.stringify(f.received.at(-1)!.messages).includes("SCRIPT_STATE_ALPHA"),
  );
  assert.ok(
    (
      await script(
        "coding",
        "store('scope','FAILED_SCRIPT_STATE');throw Error('invented failure');",
      )
    ).includes("Script failed"),
  );
  const resumed = await script("coding", "text(load('scope'));");
  assert.ok(resumed.includes("Script completed"));
  assert.ok(resumed.includes("SCRIPT_STATE_ALPHA"));
  assert.ok(!resumed.includes("FAILED_SCRIPT_STATE"));
});

test("nested MCP calls preserve tool policy and selected resource scope", async (t) => {
  const { createHash } = await import("node:crypto");
  const f = await mcpFixture(t, "nested", true);
  const installedExtensionsRoot = join(f.cwd, "operator-extensions");
  await mkdir(installedExtensionsRoot);
  const code = await readFile(
    new URL("../../../lab/terminal/fixture-extension.mjs", import.meta.url),
  );
  await writeFile(join(installedExtensionsRoot, "fixture.mjs"), code);
  await writeFile(
    f.sharedPath,
    JSON.stringify({
      ...f.shared,
      extensionCatalog: [
        {
          id: "fixture",
          sha256: createHash("sha256").update(code).digest("hex"),
          tools: ["fixture_probe"],
        },
      ],
    }),
  );
  f.definition.configuration.resources.extensions = ["fixture"];
  f.definition.configuration.tools.whitelist.push("fixture_probe");
  await writeFile(f.manifest, JSON.stringify(f.definition));
  const options = { ...f.options, installedExtensionsRoot };
  const invoke = async (target: string, args = {}) => {
    f.replies.push(
      { tool: "fixture_probe", args: { target, arguments: args } },
      { text: "finished" },
    );
    const result = await runProfileRequest(options);
    await assertMcpStopped(f.cwd);
    return JSON.parse(
      f.received
        .at(-1)!
        .messages.findLast((message) => message.role === "tool")!
        .content as string,
    );
  };
  const inspected = await invoke("mcp__fixture__inspect");
  assert.equal(inspected.privateHome, true);
  assert.equal(
    await readFile(join(f.cwd, "mcp-marker.txt"), "utf8"),
    "executed",
  );
  f.replies.push(
    {
      tool: "fixture_probe",
      args: { target: "mcp__fixture__mutate", arguments: {} },
    },
    { text: "denied" },
  );
  const denied = await runProfileRequest(options);
  const records = await readFile(denied.sessionFile!, "utf8");
  assert.ok(records.includes("Nested tool denied"));
  await assert.rejects(readFile(join(f.cwd, "mcp-forbidden.txt")));
  await assertMcpStopped(f.cwd);
  f.replies.push(
    {
      tool: "fixture_probe",
      args: {
        target: "read_mcp_resource",
        arguments: { server: "fixture", uri: "fixture://own/evidence" },
      },
    },
    { text: "read" },
  );
  await writeFile(join(f.cwd, "mcp-evidence.md"), "NESTED_RESOURCE_EVIDENCE");
  await runProfileRequest(options);
  assert.ok(
    JSON.stringify(f.received.at(-1)!.messages).includes(
      "NESTED_RESOURCE_EVIDENCE",
    ),
  );
  assert.ok(!JSON.stringify(f.received).includes("MCP_META_MUST_STAY_PRIVATE"));
  f.replies.push(
    {
      tool: "fixture_probe",
      args: {
        target: "read_mcp_resource",
        arguments: { server: "unselected", uri: "fixture://own/evidence" },
      },
    },
    { text: "denied" },
  );
  const unselected = await runProfileRequest(options);
  assert.ok(
    (await readFile(unselected.sessionFile!, "utf8")).includes(
      "Nested tool denied",
    ),
  );
  assert.equal(
    await readFile(join(f.cwd, "mcp-resource-calls.txt"), "utf8"),
    "read;",
  );
  assert.equal(await readFile(join(f.cwd, "mcp-calls.txt"), "utf8"), "called");
  await assertMcpStopped(f.cwd);
});

test("selected local MCP tools use private process settings and retain policy", async (t) => {
  const f = await mcpFixture(t);
  f.replies.push(
    { tool: "mcp__fixture__inspect", args: {} },
    { text: "inspected" },
  );
  const result = await runProfileRequest(f.options);
  assert.equal(result.output, "inspected");
  assert.equal(
    await readFile(join(f.cwd, "mcp-marker.txt"), "utf8"),
    "executed",
  );
  const content = f.received
    .at(-1)!
    .messages.find((m) => m.role === "tool")!.content;
  assert.equal(typeof content, "string");
  const observed = JSON.parse(content as string);
  assert.deepEqual(observed.keys, [
    "HOME",
    "LANG",
    "PATH",
    "TMPDIR",
    ...(process.platform === "darwin" ? ["__CF_USER_TEXT_ENCODING"] : []),
  ]);
  assert.equal(observed.privateHome, true);
  assert.deepEqual(observed.args, ["literal ${HOME}; !not-a-command"]);
  await assertMcpStopped(f.cwd);
  assert.ok(!result.toolNames.includes("mcp__fixture__mutate"));
  f.replies.push(
    { tool: "mcp__fixture__mutate", args: {} },
    { text: "denied" },
  );
  const denied = await runProfileRequest(f.options);
  const records = (await readFile(denied.sessionFile!, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    records.some(
      (entry) =>
        entry.message?.role === "toolResult" &&
        entry.message.toolName === "mcp__fixture__mutate" &&
        entry.message.isError === true,
    ),
  );
  await assert.rejects(readFile(join(f.cwd, "mcp-forbidden.txt")));
  await assertMcpStopped(f.cwd);
});

test("required local MCP startup failure prevents inference and releases the lock", async (t) => {
  const f = await mcpFixture(t, "fail-startup");
  await assert.rejects(runProfileRequest(f.options), /Local MCP/);
  assert.equal(f.received.length, 0);
  assert.ok(
    !(await readdir(join(f.stateRoot, "research"))).includes("turn.lock"),
  );
  await assertMcpStopped(f.cwd);
});

test("local MCP refuses missing installation, changed bytes and undeclared tools", async (t) => {
  const f = await mcpFixture(t);
  await assert.rejects(
    runProfileRequest({ ...f.options, installedMcpRoot: undefined }),
    /Local MCP/,
  );
  await assert.rejects(readFile(join(f.cwd, "mcp-pid.txt")));
  const module = join(f.installedMcpRoot, "fixture.mjs");
  const code = await readFile(module, "utf8");
  await writeFile(module, code + "\n// altered synthetic module\n");
  await assert.rejects(runProfileRequest(f.options), /Local MCP/);
  await assert.rejects(readFile(join(f.cwd, "mcp-pid.txt")));
  await writeFile(module, code);
  f.shared.localMcpCatalog[0]!.tools = ["inspect"];
  f.definition.configuration.tools.whitelist = [
    "read",
    "mcp__fixture__inspect",
  ];
  f.definition.configuration.tools.blacklist = [
    "bash",
    "write",
    "edit",
    "propose_profile",
  ];
  await writeFile(f.manifest, JSON.stringify(f.definition));
  await writeFile(f.sharedPath, JSON.stringify(f.shared));
  await assert.rejects(runProfileRequest(f.options), /Local MCP/);
  assert.equal(f.received.length, 0);
  await assertMcpStopped(f.cwd);
  await assert.rejects(readFile(join(f.cwd, "mcp-marker.txt")));
});

test("local MCP deadline closes stalled startup and tool work", async (t) => {
  for (const mode of ["stall-startup", "hold-tool"]) {
    const f = await mcpFixture(t, mode);
    f.definition.configuration.limits = { deadlineMs: 1000 };
    await writeFile(f.manifest, JSON.stringify(f.definition));
    if (mode === "hold-tool")
      f.replies.push({ tool: "mcp__fixture__inspect", args: {} });
    await assert.rejects(runProfileRequest(f.options), /deadline/);
    assert.equal(f.received.length, mode === "hold-tool" ? 1 : 0);
    await assertMcpStopped(f.cwd);
    assert.ok(
      !(await readdir(join(f.stateRoot, "research"))).includes("turn.lock"),
    );
    assert.ok(
      !(await readdir(join(f.stateRoot, "research", "agent"))).some((name) =>
        name.startsWith("mcp-"),
      ),
    );
  }
});

test("MCP selections survive maintenance, approval and a fresh requested turn", async (t) => {
  const f = await mcpFixture(t);
  f.replies.push({
    tool: "revise_profile",
    args: { id: "research", instructions: "MCP persona revised." },
  });
  await runProfileRequest({ ...f.options, maintain: true });
  await assertMcpStopped(f.cwd);
  const draft = await reviewProposal(f.proposalsRoot, "research");
  assert.deepEqual(draft.definition.configuration?.resources?.mcp, ["fixture"]);
  await approveProposal(
    f.profilesRoot,
    f.proposalsRoot,
    "research",
    draft.digest,
  );
  assert.deepEqual(
    (await lookupProfile(f.profilesRoot, "research")).configuration?.resources
      ?.mcp,
    ["fixture"],
  );
  await runProfileRequest(f.options);
  assert.ok(
    JSON.stringify(f.received.at(-1)!.messages).includes(
      "MCP persona revised.",
    ),
  );
  assert.ok(
    f.received
      .at(-1)!
      .tools?.some((tool) => tool.function.name === "mcp__fixture__inspect"),
  );
  await assertMcpStopped(f.cwd);
});

test("failed MCP protocol or invalid results stop continuation before another side effect", async (t) => {
  for (const mode of ["reject-tool", "large-result", "bad-result"]) {
    const f = await mcpFixture(t, mode);
    f.replies.push(
      { tool: "mcp__fixture__inspect", args: {} },
      { tool: "mcp__fixture__inspect", args: {} },
    );
    await assert.rejects(runProfileRequest(f.options));
    assert.equal(f.received.length, 1);
    assert.equal(
      await readFile(join(f.cwd, "mcp-calls.txt"), "utf8"),
      "called",
    );
    await assertMcpStopped(f.cwd);
  }
});

test("authorized MCP resources list one page and read only after an explicit request", async (t) => {
  const f = await mcpFixture(t, "normal", true);
  await writeFile(join(f.cwd, "mcp-evidence.md"), "RESOURCE_ONLY_AFTER_READ");
  f.replies.push(
    { tool: "list_mcp_resources", args: { server: "fixture" } },
    { text: "listed" },
  );
  await runProfileRequest(f.options);
  assert.ok(
    JSON.stringify(f.received.at(-1)!.messages).includes(
      "fixture://own/evidence",
    ),
  );
  assert.ok(
    !JSON.stringify(f.received.at(-1)!.messages).includes(
      "RESOURCE_ONLY_AFTER_READ",
    ),
  );
  assert.ok(
    !JSON.stringify(f.received.at(-1)!.messages).includes("second-evidence"),
  );
  assert.ok(JSON.stringify(f.received.at(-1)!.messages).includes("next-page"));
  assert.equal(
    await readFile(join(f.cwd, "mcp-resource-calls.txt"), "utf8"),
    "listed;",
  );
  f.replies.push(
    {
      tool: "list_mcp_resources",
      args: { server: "fixture", cursor: "next-page" },
    },
    { text: "next" },
  );
  await runProfileRequest(f.options);
  assert.ok(
    JSON.stringify(f.received.at(-1)!.messages).includes(
      "fixture://own/second-evidence",
    ),
  );
  f.replies.push(
    { tool: "list_mcp_resource_templates", args: { server: "fixture" } },
    { text: "templates" },
  );
  await runProfileRequest(f.options);
  assert.ok(
    JSON.stringify(f.received.at(-1)!.messages).includes(
      "fixture://own/{name}",
    ),
  );
  f.replies.push(
    {
      tool: "read_mcp_resource",
      args: { server: "fixture", uri: "fixture://own/evidence" },
    },
    { text: "read" },
  );
  await runProfileRequest(f.options);
  assert.ok(
    JSON.stringify(f.received.at(-1)!.messages).includes(
      "RESOURCE_ONLY_AFTER_READ",
    ),
  );
  assert.equal(
    await readFile(join(f.cwd, "mcp-resource-calls.txt"), "utf8"),
    "listed;listed;templates;read;",
  );
  assert.ok(!JSON.stringify(f.received).includes("MCP_META_MUST_STAY_PRIVATE"));
  await assertMcpStopped(f.cwd);
});

test("MCP resource opt-out, tool denial and unselected servers cannot reach a backend", async (t) => {
  const off = await mcpFixture(t);
  off.replies.push(
    {
      tool: "read_mcp_resource",
      args: { server: "fixture", uri: "fixture://own/evidence" },
    },
    { text: "not enabled" },
  );
  await runProfileRequest(off.options);
  await assert.rejects(readFile(join(off.cwd, "mcp-resource-calls.txt")));
  const f = await mcpFixture(t, "normal", true);
  f.shared.localMcpCatalog.push({
    ...f.shared.localMcpCatalog[0]!,
    id: "unselected",
  });
  await writeFile(f.sharedPath, JSON.stringify(f.shared));
  f.replies.push(
    {
      tool: "read_mcp_resource",
      args: { server: "unselected", uri: "fixture://own/evidence" },
    },
    { text: "denied" },
  );
  await runProfileRequest(f.options);
  await assert.rejects(readFile(join(f.cwd, "mcp-resource-calls.txt")));
  f.replies.push(
    { tool: "read_mcp_resource", args: { uri: "fixture://own/evidence" } },
    { text: "missing server denied" },
  );
  await runProfileRequest(f.options);
  await assert.rejects(readFile(join(f.cwd, "mcp-resource-calls.txt")));
  f.definition.configuration.tools.blacklist.push("read_mcp_resource");
  await writeFile(f.manifest, JSON.stringify(f.definition));
  f.replies.push(
    {
      tool: "read_mcp_resource",
      args: { server: "fixture", uri: "fixture://own/evidence" },
    },
    { text: "denied" },
  );
  const result = await runProfileRequest(f.options);
  const records = (await readFile(result.sessionFile!, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    records.some(
      (entry) =>
        entry.message?.toolName === "read_mcp_resource" &&
        entry.message.isError === true,
    ),
  );
  await assert.rejects(readFile(join(f.cwd, "mcp-resource-calls.txt")));
  await assertMcpStopped(f.cwd);
});

test("MCP resource capability must exist and absent template methods return an empty page", async (t) => {
  const absent = await mcpFixture(t, "no-resources", true);
  await assert.rejects(runProfileRequest(absent.options), /Local MCP/);
  assert.equal(absent.received.length, 0);
  await assertMcpStopped(absent.cwd);
  const f = await mcpFixture(t, "no-templates", true);
  f.replies.push(
    { tool: "list_mcp_resource_templates", args: { server: "fixture" } },
    { text: "empty" },
  );
  await runProfileRequest(f.options);
  const message = f.received
    .at(-1)!
    .messages.find((message) => message.role === "tool")!;
  assert.deepEqual(JSON.parse(message.content as string).resourceTemplates, []);
  await assertMcpStopped(f.cwd);
});

test("malformed MCP public descriptors cannot expose nested private metadata", async (t) => {
  const f = await mcpFixture(t, "bad-resource-meta", true);
  f.replies.push({ tool: "list_mcp_resources", args: { server: "fixture" } });
  await assert.rejects(runProfileRequest(f.options));
  assert.equal(f.received.length, 1);
  assert.ok(!JSON.stringify(f.received).includes("MCP_META_MUST_STAY_PRIVATE"));
  await assertMcpStopped(f.cwd);
});

test("a dropped local MCP call is never reconnected or replayed", async (t) => {
  const f = await mcpFixture(t, "crash-tool");
  f.replies.push({ tool: "mcp__fixture__inspect", args: {} });
  await assert.rejects(runProfileRequest(f.options));
  assert.equal(f.received.length, 1);
  assert.equal(await readFile(join(f.cwd, "mcp-calls.txt"), "utf8"), "called");
  await assertMcpStopped(f.cwd);
  f.shared.localMcpCatalog[0]!.args = ["normal"];
  await writeFile(f.sharedPath, JSON.stringify(f.shared));
  f.replies.push({ text: "recovered" });
  assert.equal((await runProfileRequest(f.options)).output, "recovered");
  await assertMcpStopped(f.cwd);
  assert.equal(await readFile(join(f.cwd, "mcp-calls.txt"), "utf8"), "called");
});
