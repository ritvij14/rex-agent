import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { git, main, ROOT } from "../scripts/repo-check.ts";
import { setup, verifyArchive } from "../scripts/setup.ts";
import { captureLogs, installFixtureHooks, makeRepo } from "./helpers.ts";

test("scanner archive checksum accepts only the expected bytes", () => {
  const archive = Buffer.from("synthetic archive");
  const checksum = createHash("sha256").update(archive).digest("hex");
  assert.doesNotThrow(() => verifyArchive(archive, checksum));
  assert.throws(() => verifyArchive(Buffer.from("tampered archive"), checksum));
});

test("setup accepts the pinned existing scanner and installs hooks", async (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  await setup(repo.root);
  assert.equal(
    git(repo.root, "config", "--get", "core.hooksPath").toString().trim(),
    ".githooks",
  );
});

test("setup refuses to overwrite another hooks configuration", async (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  repo.git("config", "core.hooksPath", "custom-hooks");
  await assert.rejects(setup(repo.root), /different hooksPath/);
  assert.equal(
    repo.git("config", "--get", "core.hooksPath").toString().trim(),
    "custom-hooks",
  );
});

test("setup rejects the wrong local scanner version", async (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  rmSync(join(repo.root, ".tools/gitleaks"));
  const path = repo.write(".tools/gitleaks", "#!/bin/sh\nprintf '0.0.0\\n'\n");
  chmodSync(path, 0o755);
  await assert.rejects(setup(repo.root), /Wrong or unusable local scanner/);
});

test("privacy CLI rejects unknown or conflicting modes", () => {
  for (const args of [
    [],
    ["--worktree", "--index"],
    ["--worktree", "--unknown"],
  ]) {
    assert.equal(captureLogs(() => main(args)).result, 1);
  }
});

test("CLI Git errors are sanitized instead of exposing raw diagnostics", (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  rmSync(join(repo.root, ".git"), { recursive: true });
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(repo.root, "scripts/repo-check.ts"), "--worktree"],
    { cwd: repo.root, env: repo.env, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("no raw diagnostic content"));
  assert.equal(result.stderr, "");
  assert.ok(!result.stdout.includes(repo.root));
});

test("a symlinked CLI entry still executes the privacy checks", (t) => {
  const repo = makeRepo(t);
  installFixtureHooks(repo);
  rmSync(join(repo.root, ".git"), { recursive: true });
  const entry = join(repo.root, "entry.ts");
  symlinkSync(join(repo.root, "scripts/repo-check.ts"), entry);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", entry, "--worktree"],
    { cwd: repo.root, env: repo.env, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("no raw diagnostic content"));
  assert.equal(result.stderr, "");
});

test("format CLI rejects invalid arguments without formatting files", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/format.ts", "--invalid"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("Usage:"));
});
