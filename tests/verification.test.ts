import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { ROOT } from "../scripts/repo-check.ts";
import {
  executeStep,
  main,
  sourceDigest,
  summarize,
  type Result,
} from "../scripts/verify.ts";
import { captureLogs, makeRepo } from "./helpers.ts";

function evidence(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "rex-verification-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function result(status: Result["status"]): Result {
  return {
    id: "synthetic",
    command: ["synthetic"],
    status,
    exitCode: status === "PASSED" ? 0 : 1,
    durationMs: 0,
    log: null,
  };
}

test("verification cannot hide failed, blocked, skipped or stale checks", () => {
  assert.equal(summarize([result("PASSED")]), "PASSED");
  assert.equal(summarize([result("FAILED"), result("PASSED")]), "FAILED");
  assert.equal(summarize([result("PASSED"), result("BLOCKED")]), "BLOCKED");
  assert.equal(summarize([result("NOT_RUN")]), "BLOCKED");
  assert.equal(summarize([]), "BLOCKED");
  assert.equal(summarize([result("PASSED")], false), "BLOCKED");
});

test("verification observes actual child exits and retains stdout and stderr", (t) => {
  const directory = evidence(t);
  for (const [id, exit] of [
    ["success", 0],
    ["failure", 7],
  ] as const) {
    const observed = executeStep(
      {
        id,
        command: [
          process.execPath,
          "-e",
          `console.log('synthetic action');console.error('synthetic observation');process.exit(${exit})`,
        ],
      },
      directory,
    );
    assert.equal(observed.status, exit === 0 ? "PASSED" : "FAILED");
    assert.equal(observed.exitCode, exit);
    const log = readFileSync(join(directory, observed.log!), "utf8");
    assert.match(log, /synthetic action/);
    assert.match(log, /synthetic observation/);
  }
  assert.deepEqual(readdirSync(directory).sort(), [
    "failure.log",
    "success.log",
  ]);
});

test("missing executables and terminated checks are blocked, never passed", (t) => {
  const directory = evidence(t);
  const missing = executeStep(
    { id: "missing", command: [join(directory, "not-a-tool")] },
    directory,
  );
  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.exitCode, null);
  const killed = executeStep(
    {
      id: "terminated",
      command: [process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"],
    },
    directory,
  );
  assert.equal(killed.status, "BLOCKED");
});

test("evidence steps reject unsafe names and cannot overwrite previous proof", (t) => {
  const directory = evidence(t);
  const step = {
    id: "proof",
    command: [process.execPath, "-e", "console.log('original proof')"],
  };
  executeStep(step, directory);
  assert.throws(() => executeStep(step, directory));
  assert.match(
    readFileSync(join(directory, "proof.log"), "utf8"),
    /original proof/,
  );
  assert.throws(() => executeStep({ ...step, id: "../outside" }, directory));
  assert.throws(() => executeStep({ id: "empty", command: [] }, directory));
});

test("verification CLI rejects arbitrary modes rather than executing them", () => {
  for (const args of [
    [],
    ["publish"],
    ["checks", "--skip-tests"],
    ["doctor", "reset"],
  ]) {
    const captured = captureLogs(() => main(args));
    assert.equal(captured.result, 1);
    assert.match(captured.output, /Usage:/);
  }
  assert.match(sourceDigest(), /^[a-f0-9]{64}$/);
});

test("verification retains a blocked report when source admission fails before checks", (t) => {
  const repo = makeRepo(t);
  repo.write("package.json", '{"type":"module"}');
  repo.write(".gitignore", ".local/\n");
  repo.write(".agents/settings.json", "synthetic forbidden state");
  for (const name of ["repo-check.ts", "verify.ts"]) {
    repo.write(`scripts/${name}`, readFileSync(join(ROOT, "scripts", name)));
  }
  const observed = spawnSync(
    process.execPath,
    [
      "--import",
      join(ROOT, "node_modules/tsx/dist/loader.mjs"),
      join(repo.root, "scripts/verify.ts"),
      "checks",
    ],
    { cwd: repo.root, env: repo.env, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(observed.status, 1);
  assert.ok(!observed.stderr.includes("settings.json"));
  const directory = join(repo.root, ".local/verification");
  const runs = readdirSync(directory);
  assert.equal(runs.length, 1);
  const report = JSON.parse(
    readFileSync(join(directory, runs[0]!, "report.json"), "utf8"),
  );
  assert.equal(report.scope, "checks");
  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.results, []);
});

test("Pi discovers all six project skills with valid metadata and intended invocation", () => {
  const program = `
    import {loadSkillsFromDir} from '@earendil-works/pi-coding-agent';
    const loaded=loadSkillsFromDir({dir:${JSON.stringify(join(ROOT, ".agents/skills"))},source:'project'});
    console.log(JSON.stringify({diagnostics:loaded.diagnostics,skills:loaded.skills.map(s=>({name:s.name,explicit:s.disableModelInvocation}))}));
  `;
  const observed = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", program],
    {
      cwd: join(ROOT, "packages/pi-profiles"),
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(observed.status, 0);
  const loaded = JSON.parse(observed.stdout) as {
    diagnostics: unknown[];
    skills: { name: string; explicit: boolean }[];
  };
  assert.deepEqual(loaded.diagnostics, []);
  assert.deepEqual(loaded.skills.map((s) => s.name).sort(), [
    "create-verification-skill",
    "maintain-verification-skill",
    "principle-prove-it-works",
    "principle-test-behavior-not-implementation",
    "tdd",
    "verify-rex",
  ]);
  assert.deepEqual(
    loaded.skills
      .filter((s) => s.explicit)
      .map((s) => s.name)
      .sort(),
    ["create-verification-skill", "maintain-verification-skill"],
  );
});
