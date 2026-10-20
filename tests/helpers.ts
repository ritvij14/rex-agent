import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { ROOT } from "../scripts/repo-check.ts";

export function makeRepo(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "rex-policy-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  function rawGit(...args: string[]) {
    return spawnSync("git", ["-C", root, ...args], { env });
  }
  function git(...args: string[]): Buffer {
    const result = rawGit(...args);
    assert.equal(result.status, 0, "Fixture Git command must succeed");
    return result.stdout;
  }
  function write(name: string, content: string | Buffer): string {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
  }
  git("init", "-q", "-b", "main");
  git("config", "core.hooksPath", "/dev/null");
  git("config", "user.name", "Example Contributor");
  git("config", "user.email", "123+example@users.noreply.github.com");
  return { root, env, git, rawGit, write };
}

export function installFixtureHooks(repo: ReturnType<typeof makeRepo>): void {
  for (const directory of ["scripts", ".githooks"]) {
    cpSync(join(ROOT, directory), join(repo.root, directory), {
      recursive: true,
      filter: (source) => !source.includes("__pycache__"),
    });
  }
  for (const name of [".gitignore", "package.json"]) {
    copyFileSync(join(ROOT, name), join(repo.root, name));
  }
  for (const name of readdirSync(join(repo.root, ".githooks"))) {
    chmodSync(join(repo.root, ".githooks", name), 0o755);
  }
  mkdirSync(join(repo.root, ".tools"));
  symlinkSync(
    join(ROOT, ".tools/gitleaks"),
    join(repo.root, ".tools/gitleaks"),
  );
  symlinkSync(
    join(ROOT, "node_modules"),
    join(repo.root, "node_modules"),
    "dir",
  );
  repo.git("config", "core.hooksPath", ".githooks");
  repo.write("README.md", "Synthetic public project\n");
  repo.git(
    "add",
    ".gitignore",
    "package.json",
    "README.md",
    "scripts",
    ".githooks",
  );
}

export function captureLogs<T>(action: () => T): { result: T; output: string } {
  const messages: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => messages.push(args.join(" "));
  try {
    return { result: action(), output: messages.join("\n") };
  } finally {
    console.log = original;
  }
}
