import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupProfile } from "@rex/profiles";
import { IncompleteProfileResponseError, runProfileRequest } from "./index.ts";

const SYNTHETIC_MODEL = { provider: "cli-proxy", id: "glm-5.3-flash-cloud" };

function syntheticDefinition(id: string) {
  return {
    id,
    configuration: {
      instructions: `A synthetic ${id} profile used only for response checks.`,
      model: SYNTHETIC_MODEL,
      tools: {
        whitelist: id === "coding" ? ["*"] : ["read", "ls"],
        blacklist:
          id === "coding"
            ? ["propose_profile"]
            : ["bash", "write", "edit", "propose_profile"],
      },
    },
  };
}

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
    const profilesRoot = join(root, "profiles");
    await mkdir(profilesRoot, { recursive: true });
    for (const name of ["state", "proposals", "workspace"])
      await mkdir(join(root, name));
    for (const id of ["coding", "research", "profile-builder"]) {
      await mkdir(join(profilesRoot, id));
      await writeFile(
        join(profilesRoot, id, "profile.json"),
        JSON.stringify(syntheticDefinition(id)),
      );
    }
    const options = {
      profilesRoot,
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

function assertHardenedProc() {
  const status = readFileSync("/proc/self/status", "utf8");
  assert.match(status, /CapEff:\s+0000000000000000/);
  assert.match(status, /NoNewPrivs:\s+1/);
}

async function workerMode(id: string, action: "prepare" | "verify" | "check") {
  const markerWorkspace = "/workspace/synthetic-check.txt";
  const markerState = "/state/synthetic-check.txt";
  if (action === "prepare") {
    await writeFile(markerWorkspace, id, { mode: 0o600 });
    await writeFile(markerState, id, { mode: 0o600 });
    await mkdir("/state/memory", { recursive: true });
    await writeFile("/state/memory/synthetic-marker.txt", id);
    await mkdir("/proposals/synthetic-helper", { recursive: true });
    await writeFile(
      "/proposals/synthetic-helper/profile.json",
      JSON.stringify(syntheticDefinition("synthetic-helper")),
    );
    await writeFile(
      "/proposals/synthetic-helper/provenance.json",
      JSON.stringify({
        operation: "create",
        origin: "profile-builder",
        baseDigest: null,
        sharedDigest: null,
      }),
    );
  }
  if (action === "check") {
    assert.equal(await readFile(markerWorkspace, "utf8"), id);
    assert.equal(await readFile(markerState, "utf8"), id);
    assert.equal(
      await readFile("/workspace/model-marker.txt", "utf8"),
      "synthetic-coding",
    );
    assert.ok((await readdir(`/state/profiles/${id}/sessions`)).length > 0);
  }
  assert.deepEqual((await readdir("/profiles")).sort(), [id, "shared"].sort());
  if (action === "verify") {
    assert.deepEqual(await readdir("/workspace"), []);
    assert.ok(
      !(await readdir("/state")).includes("synthetic-check.txt"),
      "another profile's state marker must be invisible",
    );
    await assert.rejects(
      lookupProfile("/profiles", id === "research" ? "coding" : "research"),
    );
    await assert.rejects(access("/state/memory/synthetic-marker.txt"));
    await assert.rejects(access("/proposals/synthetic-helper/provenance.json"));
  }
  await assert.rejects(writeFile("/profiles/forbidden", "synthetic"));
  await assert.rejects(access("/var/run/docker.sock"));
  await assert.rejects(access("/run/docker.sock"));
  await writeFile("/tmp/synthetic-tmp", "ok");
  await assert.rejects(writeFile("/forbidden-root", "synthetic"));
  await symlink("/", "/workspace/root-escape", "dir");
  assert.deepEqual(
    (await readdir("/workspace/root-escape/profiles")).sort(),
    [id, "shared"].sort(),
  );
  await rm("/workspace/root-escape", { force: true });
  assertHardenedProc();
  await new Promise<void>((resolve, reject) => {
    const req = request(
      { socketPath: "/run/rex/inference.sock", path: "/v1/models" },
      (res) => {
        assert.equal(res.statusCode, 200);
        res.resume();
        res.once("end", resolve);
      },
    );
    req.once("error", reject);
    req.end();
  });
  await assert.rejects(
    fetch("http://10.255.255.1/", { signal: AbortSignal.timeout(5000) }),
  );
}

async function main() {
  const [mode, profile, action] = process.argv.slice(2);
  if (mode === "responses") {
    await verifyResponses();
    return;
  }
  if (mode === "worker") {
    assert.ok(
      (profile === "coding" || profile === "research") &&
        (action === "prepare" || action === "verify" || action === "check"),
    );
    await workerMode(profile, action);
    console.log(`PASS: worker isolation probes for ${profile} (${action}).`);
    return;
  }
  throw new Error("Unknown verify mode");
}

main().catch(() => {
  console.error(
    "FAIL: synthetic profile container acceptance; private diagnostics omitted.",
  );
  process.exitCode = 1;
});
