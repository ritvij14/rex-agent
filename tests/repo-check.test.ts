import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  check,
  history,
  MAX_BYTES,
  pathProblems,
  ROOT,
  scanSecrets,
  snapshot,
  textProblems,
} from "../scripts/repo-check.ts";
import { captureLogs, makeRepo } from "./helpers.ts";

const bytes = (text: string) => Buffer.from(text);

test("accepts synthetic email and a portable home reference", () => {
  assert.deepEqual(textProblems(bytes("alice@example.com; use ~/.rex/")), []);
});

test("blocks personal emails, home paths, and chat IDs", () => {
  for (const text of [
    "alice" + "@" + "invalid.test",
    "/Users/" + "example/person",
    "123456789".repeat(2),
  ]) {
    assert.ok(textProblems(bytes(text)).length);
  }
});

test("blocks local private terms case-insensitively", () => {
  assert.ok(textProblems(bytes("Client Cedar"), ["client cedar"]).length);
});

test("rejects private paths even below an allowed directory", () => {
  for (const name of [
    ".env",
    "docs/.env",
    "docs/auth.json",
    ".local/notes.md",
    "packages/demo/data/state.json",
    "plugins/router.py",
    "docs/rex-pi-direction-conversation.md",
    "docs/notes.pdf",
    "docs/has space.md",
    "../README.md",
    "/tmp/README.md",
    "examples/runtime.env.example",
  ]) {
    assert.ok(pathProblems(name).length, "Private path must be rejected");
  }
});

test("allows templates, documentation, patches, and source", () => {
  for (const name of [
    "README.md",
    "lab/runtime.env.example",
    "packages/router/src/index.ts",
    ".githooks/pre-push",
    "docs/infra/testing.md",
    "patches/engine-fix.patch",
    "docs/infra/security.md",
    "tsconfig.json",
  ]) {
    assert.deepEqual(pathProblems(name), []);
  }
});

test("rejects binary, invalid UTF-8, and large files", () => {
  for (const data of [
    Buffer.from([0xff]),
    bytes("a\0b"),
    Buffer.alloc(MAX_BYTES + 1, "a"),
  ]) {
    assert.ok(textProblems(data).length);
  }
});

test("ignores private working files without reading their contents", (t) => {
  const repo = makeRepo(t);
  repo.write(".gitignore", ".local/\n.env\n");
  repo.write(".env", "NEVER READ THIS");
  repo.write(".local/privacy-terms.txt", "client cedar\n");
  repo.write(".local/auth.json", "NEVER READ THIS EITHER");
  repo.write("README.md", "Safe public description\n");
  const { entries, problems } = snapshot(repo.root, "worktree");
  assert.deepEqual(entries.map(([name]) => name).sort(), [
    ".gitignore",
    "README.md",
  ]);
  assert.deepEqual(problems, []);
});

test("ignoring an already-tracked private file does not hide it", (t) => {
  const repo = makeRepo(t);
  repo.write("docs/auth.json", "{}");
  repo.git("add", "docs/auth.json");
  repo.write(".gitignore", "**/auth.json\n");
  assert.ok(snapshot(repo.root, "worktree").problems.length);
});

test("index scan reads staged contents rather than clean working contents", (t) => {
  const repo = makeRepo(t);
  repo.write("README.md", "client cedar\n");
  repo.git("add", "README.md");
  repo.write("README.md", "Now looks clean\n");
  assert.equal(
    snapshot(repo.root, "index").entries[0]?.[1].toString(),
    "client cedar\n",
  );
  assert.equal(
    snapshot(repo.root, "worktree").entries[0]?.[1].toString(),
    "Now looks clean\n",
  );
});

test("forced staging of ignored credentials is blocked before reading", (t) => {
  const repo = makeRepo(t);
  repo.write(".env", "DO NOT READ");
  repo.git("add", "-f", ".env");
  const { entries, problems } = snapshot(repo.root, "index");
  assert.deepEqual(entries, []);
  assert.ok(problems.length);
});

test("symbolic links to host files are blocked in index and working tree", (t) => {
  const repo = makeRepo(t);
  const target = repo.write("README.md", "private fixture\n");
  mkdirSync(join(repo.root, "docs"));
  symlinkSync(target, join(repo.root, "docs/link.md"));
  repo.git("add", "docs/link.md");
  for (const mode of ["index", "worktree"] as const) {
    assert.ok(
      snapshot(repo.root, mode).problems.some(([, issue]) =>
        issue.includes("link"),
      ),
    );
  }
});

test("ancestor links are not followed into host folders", (t) => {
  const repo = makeRepo(t);
  repo.write("docs/sub/notes.md", "safe fixture");
  repo.git("add", "docs/sub/notes.md");
  rmSync(join(repo.root, "docs/sub"), { recursive: true });
  const host = mkdtempSync(join(tmpdir(), "rex-host-fixture-"));
  t.after(() => rmSync(host, { recursive: true, force: true }));
  writeFileSync(join(host, "notes.md"), "private fixture");
  symlinkSync(host, join(repo.root, "docs/sub"), "dir");
  assert.ok(
    snapshot(repo.root, "worktree").problems.some(([, issue]) =>
      issue.includes("link"),
    ),
  );
});

test("deleted files stay in the index until removal is staged", (t) => {
  const repo = makeRepo(t);
  const path = repo.write("docs/auth.json", "{}");
  repo.git("add", "docs/auth.json");
  rmSync(path);
  assert.ok(snapshot(repo.root, "index").problems.length);
  repo.git("add", "-u");
  assert.deepEqual(snapshot(repo.root, "index").problems, []);
});

test("history rejects private data deleted in a later commit", (t) => {
  const repo = makeRepo(t);
  repo.write("README.md", "Contact: " + "alice" + "@" + "invalid.test");
  repo.git("add", "README.md");
  repo.git("commit", "-qm", "Initial fixture");
  repo.write("README.md", "Safe now");
  repo.git("add", "README.md");
  repo.git("commit", "-qm", "Clean fixture");
  assert.equal(captureLogs(() => history(repo.root)).result, false);
});

test("history accepts intentionally public personal author and committer emails", (t) => {
  const repo = makeRepo(t);
  repo.git("config", "user.email", "alice" + "@" + "invalid.test");
  mkdirSync(join(repo.root, ".tools"));
  symlinkSync(
    join(ROOT, ".tools/gitleaks"),
    join(repo.root, ".tools/gitleaks"),
  );
  repo.write("README.md", "Safe fixture");
  repo.git("add", "README.md");
  repo.git("commit", "-qm", "Initial fixture");
  assert.equal(captureLogs(() => history(repo.root, true)).result, true);
});

test("history rejects private commit messages", (t) => {
  const repo = makeRepo(t);
  repo.write("README.md", "Safe fixture");
  repo.git("add", "README.md");
  repo.git("commit", "-qm", "Contact " + "alice" + "@" + "invalid.test");
  assert.equal(captureLogs(() => history(repo.root)).result, false);
});

test("clean fresh history passes", (t) => {
  const repo = makeRepo(t);
  repo.write("README.md", "Safe fixture");
  repo.git("add", "README.md");
  repo.git("commit", "-qm", "Initial public foundation");
  assert.equal(captureLogs(() => history(repo.root)).result, true);
});

test("failure output does not print private filenames or values", (t) => {
  const repo = makeRepo(t);
  repo.write("docs/alice" + "@" + "invalid.test.md", "private fixture");
  const { result, output } = captureLogs(() => check(repo.root, "worktree"));
  assert.equal(result, false);
  assert.ok(!output.includes("alice"));
  assert.ok(!output.includes("private fixture"));
});

test("a missing secret scanner fails closed", (t) => {
  const { root } = makeRepo(t);
  assert.equal(
    captureLogs(() => scanSecrets(root, [["README.md", bytes("safe")]])).result,
    false,
  );
});

test("the pinned scanner accepts clean text", () => {
  assert.equal(
    scanSecrets(ROOT, [["README.md", bytes("No credentials here.")]]),
    true,
  );
});

test("the pinned scanner blocks generated tokens without printing them", () => {
  const token =
    "gh" +
    "p_" +
    createHash("sha256")
      .update("synthetic fixture only")
      .digest("hex")
      .slice(0, 36);
  const { result, output } = captureLogs(() =>
    scanSecrets(ROOT, [["README.md", bytes(token)]]),
  );
  assert.equal(result, false);
  assert.ok(!output.includes(token));
});
